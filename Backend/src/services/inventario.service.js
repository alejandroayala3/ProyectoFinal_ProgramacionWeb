import { ErrorHttp } from '../utils/ErrorHttp.js';

// Ajuste manual (merma, conteo físico, daño). Positivo suma, negativo resta.
// Llamar dentro de una transacción Serializable.
export async function ajustarExistencia(tx, { sucursalId, insumoId, cantidadCambio, motivo }) {
    const insumo = await tx.insumo.findUnique({ where: { id: insumoId } });
    if (!insumo?.activo) throw new ErrorHttp(404, 'El insumo no existe o está inactivo');
    if (insumo.unidadBase === 'unidad' && !cantidadCambio.isInteger()) {
        throw new ErrorHttp(400, 'Este insumo se cuenta por unidades: el ajuste debe ser entero');
    }

    const condicion = { sucursalId, insumoId };
    // Al restar, la condición impide dejar existencias negativas.
    if (cantidadCambio.isNegative()) condicion.cantidadActual = { gte: cantidadCambio.abs() };
    const resultado = await tx.existenciaSucursal.updateMany({
        where: condicion,
        data: { cantidadActual: { increment: cantidadCambio } },
    });
    if (resultado.count !== 1) {
        const existe = await tx.existenciaSucursal.findUnique({ where: { sucursalId_insumoId: { sucursalId, insumoId } } });
        if (!existe) throw new ErrorHttp(404, 'El insumo no tiene existencia registrada en esta sucursal');
        throw new ErrorHttp(409, `El ajuste dejaría negativo el inventario (hay ${existe.cantidadActual} ${insumo.unidadBase})`);
    }

    return tx.movimientoInventario.create({
        data: { sucursalId, insumoId, tipo: 'ajuste', cantidadCambio, motivo },
    });
}
