import { Prisma } from '@prisma/client';

export const metodosCobro = Object.freeze(['efectivo', 'tarjeta', 'digital', 'bitcoin']);
const cero = new Prisma.Decimal(0);
const maximoImporte = new Prisma.Decimal('9999999999.99');

export class ErrorCaja extends Error {
    constructor(codigo, mensaje) {
        super(mensaje);
        this.codigo = codigo;
    }
}

function textoObligatorio(valor, maximo, etiqueta) {
    if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > maximo) {
        throw new ErrorCaja('DATO_INVALIDO', `Revisa ${etiqueta}.`);
    }
    return valor.trim();
}

function importe(valor, permiteCero = false) {
    let monto;
    try {
        monto = new Prisma.Decimal(valor);
    } catch {
        throw new ErrorCaja('MONTO_INVALIDO', 'El monto debe ser un número válido.');
    }
    if (!monto.isFinite() || monto.decimalPlaces() > 2 ||
        (permiteCero ? monto.lt(0) : monto.lte(0)) || monto.gt(maximoImporte)) {
        throw new ErrorCaja('MONTO_INVALIDO', 'El monto está fuera de rango o tiene más de dos decimales.');
    }
    return monto;
}

// Todas las operaciones reciben el cliente de una transacción interactiva.
async function bloquearTurno(tx, turnoId) {
    const [fila] = await tx.$queryRaw`
        SELECT id FROM dbo.turnos_caja WITH (UPDLOCK, HOLDLOCK) WHERE id = ${turnoId}
    `;
    if (!fila) throw new ErrorCaja('TURNO_INEXISTENTE', 'El turno no existe.');
    return tx.turnoCaja.findUniqueOrThrow({ where: { id: turnoId } });
}

function exigirTurnoAbierto(turno) {
    if (turno.fechaCierre) throw new ErrorCaja('TURNO_CERRADO', 'El turno está cerrado.');
}

export async function abrirTurno(tx, { referencia, sucursalId, usuarioId, fondoInicial }) {
    referencia = textoObligatorio(referencia, 60, 'la referencia del turno');
    fondoInicial = importe(fondoInicial, true);
    const previo = await tx.turnoCaja.findUnique({ where: { referencia } });
    if (previo) {
        if (previo.referencia !== referencia || previo.sucursalId !== sucursalId ||
            previo.usuarioId !== usuarioId || !previo.fondoInicial.equals(fondoInicial)) {
            throw new ErrorCaja('REFERENCIA_EN_USO', 'La referencia pertenece a un turno con otros datos.');
        }
        return previo;
    }

    const sucursal = await tx.sucursal.findUnique({ where: { id: sucursalId }, select: { activo: true } });
    const usuario = await tx.usuario.findUnique({
        where: { id: usuarioId }, select: { activo: true, sucursalId: true },
    });
    if (!sucursal?.activo || !usuario?.activo ||
        (usuario.sucursalId !== null && usuario.sucursalId !== sucursalId)) {
        throw new ErrorCaja('APERTURA_INVALIDA', 'El usuario activo debe poder operar en la sucursal activa.');
    }
    return tx.turnoCaja.create({ data: { referencia, sucursalId, usuarioId, fondoInicial, fechaApertura: new Date() } });
}

export async function registrarCobro(tx, { referencia, referenciaExterna = null, turnoId, ventaId, metodo, monto }) {
    referencia = textoObligatorio(referencia, 60, 'la referencia del cobro');
    if (referenciaExterna !== null) {
        referenciaExterna = textoObligatorio(referenciaExterna, 60, 'la referencia externa');
    }
    monto = importe(monto);
    if (!metodosCobro.includes(metodo)) throw new ErrorCaja('METODO_INVALIDO', 'El medio de pago no es válido.');

    const turno = await bloquearTurno(tx, turnoId);
    const previo = await tx.cobroVenta.findUnique({ where: { referencia } });
    if (previo) {
        if (previo.referencia !== referencia || previo.turnoId !== turnoId ||
            previo.ventaId !== ventaId || previo.metodo !== metodo || previo.referenciaExterna !== referenciaExterna ||
            !previo.monto.equals(monto)) {
            throw new ErrorCaja('REFERENCIA_EN_USO', 'La referencia pertenece a un cobro con otros datos.');
        }
        return previo;
    }
    exigirTurnoAbierto(turno);

    // El bloqueo de la venta serializa sus cobros, incluso si vienen de turnos distintos.
    const [venta] = await tx.$queryRaw`
        SELECT sucursal_id AS sucursalId, total FROM dbo.ventas WITH (UPDLOCK, HOLDLOCK) WHERE id = ${ventaId}
    `;
    if (!venta || venta.sucursalId !== turno.sucursalId) {
        throw new ErrorCaja('VENTA_INVALIDA', 'La venta debe pertenecer a la sucursal del turno.');
    }
    const { _sum } = await tx.cobroVenta.aggregate({ where: { ventaId }, _sum: { monto: true } });
    if ((_sum.monto ?? cero).plus(monto).gt(venta.total)) {
        throw new ErrorCaja('SOBREPAGO', 'El cobro supera el saldo pendiente de la venta.');
    }
    return tx.cobroVenta.create({
        data: { referencia, referenciaExterna, turnoId, ventaId, sucursalId: turno.sucursalId, metodo, monto, fecha: new Date() },
    });
}

export async function registrarMovimientoCaja(tx, { referencia, turnoId, tipo, monto, motivo }) {
    referencia = textoObligatorio(referencia, 60, 'la referencia del movimiento');
    motivo = textoObligatorio(motivo, 150, 'el motivo');
    monto = importe(monto);
    if (!['entrada', 'salida'].includes(tipo)) {
        throw new ErrorCaja('TIPO_INVALIDO', 'El movimiento debe ser una entrada o una salida.');
    }

    const turno = await bloquearTurno(tx, turnoId);
    const previo = await tx.movimientoCaja.findUnique({ where: { referencia } });
    if (previo) {
        if (previo.referencia !== referencia || previo.turnoId !== turnoId ||
            previo.tipo !== tipo || previo.motivo !== motivo || !previo.monto.equals(monto)) {
            throw new ErrorCaja('REFERENCIA_EN_USO', 'La referencia pertenece a un movimiento con otros datos.');
        }
        return previo;
    }
    exigirTurnoAbierto(turno);
    return tx.movimientoCaja.create({ data: { referencia, turnoId, tipo, monto, motivo, fecha: new Date() } });
}

export async function cerrarTurno(tx, { turnoId, efectivoContado }) {
    efectivoContado = importe(efectivoContado, true);
    const turno = await bloquearTurno(tx, turnoId);
    if (turno.fechaCierre) {
        if (!turno.efectivoContado.equals(efectivoContado)) {
            throw new ErrorCaja('TURNO_CERRADO', 'El turno ya se cerró con otro monto contado.');
        }
        return turno;
    }

    const cobros = await tx.cobroVenta.groupBy({ by: ['metodo'], where: { turnoId }, _sum: { monto: true } });
    const movimientos = await tx.movimientoCaja.groupBy({ by: ['tipo'], where: { turnoId }, _sum: { monto: true } });
    const porMetodo = new Map(cobros.map(fila => [fila.metodo, fila._sum.monto]));
    const porTipo = new Map(movimientos.map(fila => [fila.tipo, fila._sum.monto]));
    const efectivoEsperado = turno.fondoInicial
        .plus(porMetodo.get('efectivo') ?? cero)
        .plus(porTipo.get('entrada') ?? cero)
        .minus(porTipo.get('salida') ?? cero);

    return tx.turnoCaja.update({
        where: { id: turnoId },
        data: {
            fechaCierre: new Date(),
            efectivoEsperado,
            efectivoContado,
            diferencia: efectivoContado.minus(efectivoEsperado),
            totalTarjeta: porMetodo.get('tarjeta') ?? cero,
            totalDigital: porMetodo.get('digital') ?? cero,
            totalBitcoin: porMetodo.get('bitcoin') ?? cero,
        },
    });
}
