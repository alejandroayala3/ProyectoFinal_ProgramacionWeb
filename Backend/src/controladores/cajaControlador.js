import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { ejecutarTransaccion } from '../utils/transaccion.js';
import { filtroSucursal, sucursalOperacion, verificarAccesoTurno } from '../utils/alcanceSucursal.js';
import { booleanoOpcional, decimal, enteroPositivo, limite, opcion, textoOpcional, textoRequerido } from '../utils/validacion.js';
import { abrirTurno, cerrarTurno, metodosCobro, registrarCobro, registrarMovimientoCaja } from '../services/caja.service.js';

const cero = new Prisma.Decimal(0);

// Resumen del turno: totales por medio de pago y efectivo que debería haber en caja.
async function resumenTurno(turnoId) {
    const turno = await prisma.turnoCaja.findUnique({
        where: { id: turnoId },
        include: {
            sucursal: { select: { id: true, nombre: true } },
            usuario: { select: { id: true, nombreCompleto: true } },
            movimientos: { orderBy: { fecha: 'asc' } },
        },
    });
    if (!turno) throw new ErrorHttp(404, 'El turno no existe');

    const cobros = await prisma.cobroVenta.groupBy({
        by: ['metodo'], where: { turnoId }, _sum: { monto: true }, _count: { _all: true },
    });
    const porMetodo = Object.fromEntries(metodosCobro.map(metodo => {
        const fila = cobros.find(cobro => cobro.metodo === metodo);
        return [metodo, { total: fila?._sum.monto ?? cero, cobros: fila?._count._all ?? 0 }];
    }));
    const sumar = tipo => turno.movimientos.filter(m => m.tipo === tipo).reduce((s, m) => s.plus(m.monto), cero);
    const entradas = sumar('entrada');
    const salidas = sumar('salida');

    return {
        ...turno,
        abierto: turno.fechaCierre === null,
        resumen: {
            porMetodo,
            entradasManuales: entradas,
            salidasManuales: salidas,
            efectivoEsperadoActual: turno.fondoInicial.plus(porMetodo.efectivo.total).plus(entradas).minus(salidas),
        },
    };
}

async function turnoAutorizado(peticion) {
    const turnoId = enteroPositivo(peticion.params.id, 'El id del turno');
    const turno = await prisma.turnoCaja.findUnique({ where: { id: turnoId } });
    verificarAccesoTurno(peticion.auth, turno);
    return turnoId;
}

// GET /api/caja/turnos?sucursalId=&abierto=
export async function listarTurnos(peticion, respuesta) {
    const abierto = booleanoOpcional(peticion.query.abierto, 'El filtro abierto');
    const turnos = await prisma.turnoCaja.findMany({
        where: {
            sucursalId: filtroSucursal(peticion.auth, peticion.query.sucursalId),
            fechaCierre: abierto === null ? undefined : abierto ? null : { not: null },
        },
        include: { sucursal: { select: { nombre: true } }, usuario: { select: { nombreCompleto: true } } },
        orderBy: { fechaApertura: 'desc' },
        take: limite(peticion.query.limite),
    });
    return respuesta.json({ turnos });
}

// GET /api/caja/turnos/actual — turno abierto del usuario que inició sesión.
export async function obtenerTurnoActual(peticion, respuesta) {
    const turno = await prisma.turnoCaja.findFirst({
        where: { usuarioId: peticion.auth.idUsuario, fechaCierre: null },
        orderBy: { fechaApertura: 'desc' },
        select: { id: true },
    });
    if (!turno) throw new ErrorHttp(404, 'No tienes un turno de caja abierto');
    return respuesta.json({ turno: await resumenTurno(turno.id) });
}

// GET /api/caja/turnos/:id
export async function obtenerTurno(peticion, respuesta) {
    return respuesta.json({ turno: await resumenTurno(await turnoAutorizado(peticion)) });
}

// POST /api/caja/turnos — apertura con fondo inicial.
export async function crearTurno(peticion, respuesta) {
    const sucursalId = sucursalOperacion(peticion.auth, peticion.body?.sucursalId);
    const fondoInicial = decimal(peticion.body?.fondoInicial, 'El fondo inicial', { permiteCero: true });
    const usuarioId = peticion.auth.idUsuario;

    const turno = await ejecutarTransaccion(async (tx) => {
        // Un usuario no puede tener dos turnos abiertos a la vez.
        const abierto = await tx.turnoCaja.findFirst({ where: { usuarioId, fechaCierre: null }, select: { id: true } });
        if (abierto) throw new ErrorHttp(409, 'Ya tienes un turno abierto; ciérralo antes de abrir otro', { turnoId: abierto.id });
        return abrirTurno(tx, { referencia: `TURNO-${randomUUID()}`, sucursalId, usuarioId, fondoInicial });
    });
    return respuesta.status(201).location(`/api/caja/turnos/${turno.id}`).json({ turno: await resumenTurno(turno.id) });
}

// POST /api/caja/turnos/:id/cobros — cobro (o abono) de una venta ya registrada.
export async function crearCobro(peticion, respuesta) {
    const turnoId = await turnoAutorizado(peticion);
    const cuerpo = peticion.body ?? {};
    const cobro = await ejecutarTransaccion(tx => registrarCobro(tx, {
        referencia: textoOpcional(cuerpo.referencia, 60, 'La referencia') ?? `COBRO-${randomUUID()}`,
        turnoId,
        ventaId: enteroPositivo(cuerpo.ventaId, 'La venta'),
        metodo: opcion(cuerpo.metodo, metodosCobro, 'El método de pago'),
        referenciaExterna: textoOpcional(cuerpo.referenciaExterna, 60, 'La referencia externa'),
        monto: decimal(cuerpo.monto, 'El monto'),
    }));
    return respuesta.status(201).json({ cobro });
}

// POST /api/caja/turnos/:id/movimientos — entradas o salidas manuales de efectivo.
export async function crearMovimiento(peticion, respuesta) {
    const turnoId = await turnoAutorizado(peticion);
    const cuerpo = peticion.body ?? {};
    const movimiento = await ejecutarTransaccion(tx => registrarMovimientoCaja(tx, {
        referencia: `MOV-${randomUUID()}`,
        turnoId,
        tipo: opcion(cuerpo.tipo, ['entrada', 'salida'], 'El tipo de movimiento'),
        monto: decimal(cuerpo.monto, 'El monto'),
        motivo: textoRequerido(cuerpo.motivo, 150, 'El motivo'),
    }));
    return respuesta.status(201).json({ movimiento });
}

// POST /api/caja/turnos/:id/cierre — arqueo: compara el efectivo contado con el esperado.
export async function cerrarTurnoCaja(peticion, respuesta) {
    const turnoId = await turnoAutorizado(peticion);
    const efectivoContado = decimal(peticion.body?.efectivoContado, 'El efectivo contado', { permiteCero: true });
    await ejecutarTransaccion(tx => cerrarTurno(tx, { turnoId, efectivoContado }));
    return respuesta.json({ mensaje: 'Turno cerrado', turno: await resumenTurno(turnoId) });
}
