import { Prisma } from '@prisma/client';
import { ErrorHttp } from '../utils/ErrorHttp.js';

const factorIva = new Prisma.Decimal('1.13');
const cero = new Prisma.Decimal(0);

// Los precios del menú incluyen IVA: se separa la base dividiendo entre 1.13.
export function calcularImportes(lineas) {
    const total = lineas.reduce(
        (acumulado, { precioUnitario, cantidad }) => acumulado.plus(precioUnitario.mul(cantidad)),
        cero,
    );
    const subtotal = total.div(factorIva).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return { subtotal, iva: total.minus(subtotal), total };
}

// Qué insumos consume una porción: la receta (elaborado) o 1 unidad (reventa).
function consumoPorPorcion(producto) {
    if (producto.tipo === 'reventa') {
        const insumo = producto.insumoReventa;
        if (!insumo?.activo || insumo.unidadBase !== 'unidad') {
            throw new ErrorHttp(409, `El producto de reventa ${producto.nombre} no tiene un insumo activo por unidad`);
        }
        return [{ insumo, cantidad: new Prisma.Decimal(1) }];
    }
    if (producto.recetas.length === 0 || producto.recetas.some(({ insumo, cantidad }) => !insumo.activo || !cantidad.gt(0))) {
        throw new ErrorHttp(409, `El producto ${producto.nombre} no tiene una receta válida`);
    }
    return producto.recetas;
}

// Registra la venta, guarda el precio histórico y descuenta inventario.
// Debe llamarse dentro de una transacción Serializable.
export async function registrarVenta(tx, { referencia, sucursalId, usuarioId, lineas }) {
    const productos = await tx.producto.findMany({
        where: { id: { in: lineas.map(linea => linea.productoId) }, activo: true, categoria: { activo: true } },
        include: { recetas: { include: { insumo: true } }, insumoReventa: true },
    });
    if (productos.length !== lineas.length) {
        throw new ErrorHttp(404, 'Uno o más productos no existen o no están disponibles');
    }

    const cantidadPorProducto = new Map(lineas.map(linea => [linea.productoId, linea.cantidad]));
    const consumoAgrupado = new Map();
    const detalles = productos.map(producto => {
        const cantidad = cantidadPorProducto.get(producto.id);
        const consumos = consumoPorPorcion(producto).map(({ insumo, cantidad: porPorcion }) => {
            const requerido = porPorcion.mul(cantidad);
            const previo = consumoAgrupado.get(insumo.id)?.cantidad ?? cero;
            consumoAgrupado.set(insumo.id, { nombre: insumo.nombre, cantidad: previo.plus(requerido) });
            return { insumoId: insumo.id, cantidadCambio: requerido.negated() };
        });
        return { productoId: producto.id, cantidad, precioUnitario: producto.precioVenta, consumos };
    });

    const venta = await tx.venta.create({
        data: { referencia, sucursalId, usuarioId, ...calcularImportes(detalles) },
    });

    const movimientos = [];
    for (const { consumos, ...detalle } of detalles) {
        const guardado = await tx.detalleVenta.create({ data: { ...detalle, ventaId: venta.id }, select: { id: true } });
        movimientos.push(...consumos.map(consumo => ({
            ...consumo,
            sucursalId,
            detalleVentaId: guardado.id,
            tipo: 'salida',
            motivo: `Salida por venta ${referencia}`,
        })));
    }

    // Descuenta una sola vez por insumo y en orden fijo para evitar bloqueos cruzados.
    const ordenados = [...consumoAgrupado].sort(([a], [b]) => a - b);
    for (const [insumoId, { nombre, cantidad }] of ordenados) {
        const resultado = await tx.existenciaSucursal.updateMany({
            where: { sucursalId, insumoId, cantidadActual: { gte: cantidad } },
            data: { cantidadActual: { decrement: cantidad } },
        });
        if (resultado.count !== 1) {
            throw new ErrorHttp(409, `Existencias insuficientes de ${nombre} en la sucursal`, { insumoId });
        }
    }

    await tx.movimientoInventario.createMany({ data: movimientos });
    return venta;
}
