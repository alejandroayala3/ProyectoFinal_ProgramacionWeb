import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ErrorHttp } from '../utils/ErrorHttp.js';

const tasaIva = new Prisma.Decimal('0.13');
const cero = new Prisma.Decimal(0);

function redondear(valor) {
    return valor.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function calcularImportesCompra(detalles) {
    const subtotal = redondear(detalles.reduce(
        (suma, { cantidad, costoUnitario }) => suma.plus(cantidad.mul(costoUnitario)), cero,
    ));
    const iva = redondear(subtotal.mul(tasaIva));
    return { subtotal, iva, total: subtotal.plus(iva) };
}

// Registra la factura del proveedor, aumenta existencias y guarda los abonos iniciales.
// Lo que queda sin pagar es la cuenta por pagar. Llamar dentro de una transacción Serializable.
export async function registrarCompra(tx, { proveedorId, sucursalId, numeroFactura, detalles, pagos }) {
    const proveedor = await tx.proveedor.findUnique({ where: { id: proveedorId } });
    if (!proveedor?.activo) throw new ErrorHttp(404, 'El proveedor no existe o está inactivo');

    const insumos = await tx.insumo.findMany({ where: { id: { in: detalles.map(d => d.insumoId) }, activo: true } });
    if (insumos.length !== detalles.length) throw new ErrorHttp(404, 'Uno o más insumos no existen o están inactivos');
    const porId = new Map(insumos.map(insumo => [insumo.id, insumo]));
    for (const { insumoId, cantidad } of detalles) {
        if (porId.get(insumoId).unidadBase === 'unidad' && !cantidad.isInteger()) {
            throw new ErrorHttp(400, `La cantidad de ${porId.get(insumoId).nombre} debe ser entera`);
        }
    }

    const importes = calcularImportesCompra(detalles);
    const totalPagado = pagos.reduce((suma, pago) => suma.plus(pago.monto), cero);
    if (totalPagado.gt(importes.total)) throw new ErrorHttp(409, 'Los pagos superan el total de la compra');

    const compra = await tx.compra.create({
        data: {
            proveedorId,
            sucursalId,
            numeroFactura,
            ...importes,
            detalles: { create: detalles },
            pagos: { create: pagos.map(pago => ({ ...pago, referencia: pago.referencia ?? `PAGO-${randomUUID()}` })) },
        },
        include: { detalles: true },
    });

    for (const detalle of compra.detalles) {
        const clave = { sucursalId, insumoId: detalle.insumoId };
        // Si el insumo aún no tenía existencia en la sucursal, se crea con lo comprado.
        await tx.existenciaSucursal.upsert({
            where: { sucursalId_insumoId: clave },
            create: { ...clave, cantidadActual: detalle.cantidad },
            update: { cantidadActual: { increment: detalle.cantidad } },
        });
        await tx.movimientoInventario.create({
            data: {
                ...clave,
                detalleCompraId: detalle.id,
                tipo: 'entrada',
                cantidadCambio: detalle.cantidad,
                costoUnitarioCompra: detalle.costoUnitario,
                motivo: `Entrada por compra ${numeroFactura}`,
            },
        });
    }
    return compra;
}

// Abono a una cuenta por pagar. Bloquea la compra para que dos abonos simultáneos no la sobrepaguen.
export async function registrarPagoCompra(tx, { compraId, metodo, monto, referencia }) {
    const [fila] = await tx.$queryRaw`
        SELECT id FROM dbo.compras WITH (UPDLOCK, HOLDLOCK) WHERE id = ${compraId}
    `;
    if (!fila) throw new ErrorHttp(404, 'La compra no existe');

    const compra = await tx.compra.findUniqueOrThrow({ where: { id: compraId } });
    const { _sum } = await tx.pagoCompra.aggregate({ where: { compraId }, _sum: { monto: true } });
    const saldo = compra.total.minus(_sum.monto ?? cero);
    if (monto.gt(saldo)) throw new ErrorHttp(409, `El pago supera el saldo pendiente de $${saldo.toFixed(2)}`);

    return tx.pagoCompra.create({
        data: { compraId, metodo, monto, referencia: referencia ?? `PAGO-${randomUUID()}` },
    });
}
