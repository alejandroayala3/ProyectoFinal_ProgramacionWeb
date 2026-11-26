import { pathToFileURL } from 'node:url';
import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';

const referenciaDemo = 'DEMO-VENTA-001';
export const lineasDemo = [
    { codigo: 'PRI-POLLO-PARRILLA', cantidad: 1, precio: '7.00' },
    { codigo: 'REV-AGUA-500-ML', cantidad: 1, precio: '1.50' },
];

class ConflictoVenta extends Error {}

export class StockInsuficiente extends Error {
    constructor(codigo) {
        super(`Existencias insuficientes en Sucursal Central para ${codigo}.`);
        this.codigoInsumo = codigo;
    }
}

function calcularImportes(lineas) {
    const total = lineas.reduce(
        (acumulado, { precioUnitario, cantidad }) => acumulado.plus(precioUnitario.mul(cantidad)),
        new Prisma.Decimal(0),
    );
    const subtotal = total.div('1.13').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return { subtotal, iva: total.minus(subtotal), total };
}

function consumoPorPorcion(producto) {
    if (producto.tipo === 'reventa') {
        const insumo = producto.insumoReventa;
        if (!insumo?.activo || insumo.unidadBase !== 'unidad' || producto.recetas.length > 0) {
            throw new ConflictoVenta(`La reventa ${producto.codigo} requiere un insumo activo en unidades y debe estar sin receta.`);
        }
        return [{ insumo, cantidad: new Prisma.Decimal(1) }];
    }

    if (producto.tipo !== 'elaborado' || producto.recetas.length === 0 ||
        producto.recetas.some(({ insumo, cantidad }) =>
            !insumo.activo || !cantidad.gt(0) || (insumo.unidadBase === 'unidad' && !cantidad.isInteger())
        )) {
        throw new ConflictoVenta(`Falta una receta válida para ${producto.codigo}.`);
    }
    return producto.recetas;
}

function resumir(venta, creada) {
    return {
        referencia: venta.referencia,
        ventaId: venta.id,
        creada,
        subtotal: venta.subtotal.toFixed(2),
        iva: venta.iva.toFixed(2),
        total: venta.total.toFixed(2),
    };
}

export async function registrarVentaPrueba(referencia, lineas) {
    if (process.env.DB_HOST?.toLowerCase() !== 'localhost' ||
        Number(process.env.DB_PORT) !== 1432 || process.env.DB_NAME !== 'origenesv_nuevo') {
        throw new ConflictoVenta('La carga solo se puede ejecutar en localhost:1432/origenesv_nuevo.');
    }

    const porCodigo = new Map(lineas.map(linea => [linea.codigo, linea]));
    if (!/^DEMO-VENTA-[A-Z0-9-]{1,39}$/.test(referencia) ||
        !lineas.length || porCodigo.size !== lineas.length ||
        lineas.some(({ cantidad }) => !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 2147483647)) {
        throw new ConflictoVenta('La referencia o las cantidades de la venta de prueba no son válidas.');
    }

    return prisma.$transaction(async (tx) => {
        const [destino] = await tx.$queryRaw`
            SELECT DB_NAME() AS base, CONVERT(int, CONNECTIONPROPERTY('local_tcp_port')) AS puerto
        `;
        if (destino?.base !== 'origenesv_nuevo' || destino.puerto !== 1432) {
            throw new ConflictoVenta('La conexión SQL no corresponde a la base y puerto esperados.');
        }

        const sucursal = await tx.sucursal.findUnique({ where: { nombre: 'Sucursal Central' } });
        const usuario = await tx.usuario.findUnique({ where: { correo: 'admin@origenes.sv' } });
        if (!sucursal?.activo || !usuario?.activo || usuario.sucursalId !== sucursal.id) {
            throw new ConflictoVenta('Falta la cuenta activa de prueba de Sucursal Central.');
        }

        const previa = await tx.venta.findUnique({
            where: { referencia },
            include: { detalles: { include: { producto: { select: { codigo: true } }, movimientos: true } } },
        });
        if (previa) {
            const importes = calcularImportes(previa.detalles);
            if (previa.sucursalId !== sucursal.id || previa.usuarioId !== usuario.id ||
                previa.detalles.length !== lineas.length ||
                previa.detalles.some(detalle => {
                    const esperado = porCodigo.get(detalle.producto.codigo);
                    return !esperado || detalle.cantidad !== esperado.cantidad ||
                        !detalle.precioUnitario.equals(esperado.precio) ||
                        detalle.movimientos.length === 0 ||
                        detalle.movimientos.some(movimiento =>
                            movimiento.sucursalId !== sucursal.id || movimiento.tipo !== 'salida'
                        );
                }) ||
                !previa.subtotal.equals(importes.subtotal) || !previa.iva.equals(importes.iva) ||
                !previa.total.equals(importes.total)) {
                throw new ConflictoVenta('La referencia ya existe con datos distintos o sin sus salidas de inventario.');
            }
            return resumir(previa, false);
        }

        const productos = await tx.producto.findMany({
            where: { codigo: { in: [...porCodigo.keys()] }, activo: true, categoria: { activo: true } },
            include: { recetas: { include: { insumo: true } }, insumoReventa: true },
        });
        if (productos.length !== lineas.length) {
            throw new ConflictoVenta('Faltan productos activos o su categoría está inactiva.');
        }

        const consumoAgrupado = new Map();
        const detalles = productos.map(producto => {
            const linea = porCodigo.get(producto.codigo);
            if (!linea || !producto.precioVenta.equals(linea.precio)) {
                throw new ConflictoVenta(`El precio de catálogo de ${producto.codigo} difiere del precio de prueba.`);
            }

            const consumos = consumoPorPorcion(producto).map(({ insumo, cantidad }) => {
                const requerido = cantidad.mul(linea.cantidad);
                const previo = consumoAgrupado.get(insumo.id)?.cantidad ?? new Prisma.Decimal(0);
                consumoAgrupado.set(insumo.id, { codigo: insumo.codigo, cantidad: previo.plus(requerido) });
                return { insumoId: insumo.id, cantidadCambio: requerido.negated() };
            });
            return { productoId: producto.id, cantidad: linea.cantidad, precioUnitario: producto.precioVenta, consumos };
        });

        const venta = await tx.venta.create({
            data: { referencia, usuarioId: usuario.id, sucursalId: sucursal.id, ...calcularImportes(detalles) },
        });

        const movimientos = [];
        for (const { consumos, ...detalle } of detalles) {
            const guardado = await tx.detalleVenta.create({ data: { ...detalle, ventaId: venta.id }, select: { id: true } });
            movimientos.push(...consumos.map(consumo => ({
                ...consumo,
                sucursalId: sucursal.id,
                detalleVentaId: guardado.id,
                tipo: 'salida',
                motivo: `Salida por venta ${referencia}`,
            })));
        }

        // Descontar una sola vez por insumo, siempre en el mismo orden.
        const consumosOrdenados = [...consumoAgrupado].sort(([a], [b]) => a - b);
        for (const [insumoId, { codigo, cantidad }] of consumosOrdenados) {
            const resultado = await tx.existenciaSucursal.updateMany({
                where: { sucursalId: sucursal.id, insumoId, cantidadActual: { gte: cantidad } },
                data: { cantidadActual: { decrement: cantidad } },
            });
            if (resultado.count !== 1) throw new StockInsuficiente(codigo);
        }

        const guardados = await tx.movimientoInventario.createMany({ data: movimientos });
        if (guardados.count !== movimientos.length) {
            throw new ConflictoVenta('No se guardaron todas las salidas de inventario.');
        }
        return resumir(venta, true);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        console.log(JSON.stringify(await registrarVentaPrueba(referenciaDemo, lineasDemo), null, 2));
    } catch (error) {
        if (error instanceof ConflictoVenta || error instanceof StockInsuficiente) {
            console.error(error.message);
        } else if (error.code === 'P2002' || error.code === 'P2034') {
            console.error(`La transacción se revirtió por un conflicto de datos o concurrencia (${error.code}). Puedes volver a ejecutarla.`);
        } else {
            console.error(`No se completó la venta. Revisa Prisma y la conexión (${error.code ?? error.name}).`);
        }
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}
