import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { filtroSucursal } from '../utils/alcanceSucursal.js';
import { ejecutarTransaccion } from '../utils/transaccion.js';
import { enteroPositivo, decimal } from '../utils/validacion.js';
import { calcular_planilla_empleado, registrarPlanillaQuincenal } from '../services/planilla.service.js';

const cero = new Prisma.Decimal(0);

function totalizar(detalles) {
    const sumar = campo => detalles.reduce((suma, detalle) => suma.plus(detalle[campo]), cero);
    return {
        empleados: detalles.length,
        salarios: sumar('salarioPeriodo'),
        isss: sumar('isss'),
        afp: sumar('afp'),
        renta: sumar('renta'),
        neto: sumar('neto'),
    };
}

function leerPeriodo(cuerpo) {
    const anio = enteroPositivo(cuerpo?.anio, 'El año');
    const mes = enteroPositivo(cuerpo?.mes, 'El mes');
    const quincena = enteroPositivo(cuerpo?.quincena, 'La quincena');
    if (anio < 2000 || anio > 2100 || mes > 12 || quincena > 2) {
        throw new ErrorHttp(400, 'Indica un año válido, un mes del 1 al 12 y la quincena 1 o 2');
    }
    const inicio = new Date(Date.UTC(anio, mes - 1, quincena === 1 ? 1 : 16));
    const fin = quincena === 1 ? new Date(Date.UTC(anio, mes - 1, 15)) : new Date(Date.UTC(anio, mes, 0));
    return { anio, mes, quincena, inicio, fin };
}

function filtroDetalles(sucursalId) {
    return sucursalId === undefined ? undefined : { empleado: { sucursalId } };
}

// GET /api/planillas
export async function listarPlanillas(peticion, respuesta) {
    const filtro = filtroDetalles(filtroSucursal(peticion.auth));
    const planillas = await prisma.planilla.findMany({
        where: filtro ? { detalles: { some: filtro } } : undefined,
        include: { detalles: { where: filtro } },
        orderBy: { periodoInicio: 'desc' },
    });
    return respuesta.json({
        planillas: planillas.map(({ detalles, ...planilla }) => ({ ...planilla, totales: totalizar(detalles) })),
    });
}

async function cargarPlanilla(id, sucursalId) {
    const planilla = await prisma.planilla.findUnique({
        where: { id },
        include: {
            detalles: {
                where: filtroDetalles(sucursalId),
                include: {
                    empleado: {
                        select: { codigo: true, nombreCompleto: true, cargo: true, salarioMensual: true, sucursal: { select: { nombre: true } } },
                    },
                },
                orderBy: { empleado: { nombreCompleto: 'asc' } },
            },
        },
    });
    if (!planilla) throw new ErrorHttp(404, 'La planilla no existe');
    if (sucursalId !== undefined && !planilla.detalles.length) {
        throw new ErrorHttp(403, 'La planilla no contiene empleados de tu sucursal');
    }
    return { ...planilla, totales: totalizar(planilla.detalles) };
}

// GET /api/planillas/:id — boletas de cada empleado y totales.
export async function obtenerPlanilla(peticion, respuesta) {
    const id = enteroPositivo(peticion.params.id, 'El id de la planilla');
    const planilla = await cargarPlanilla(id, filtroSucursal(peticion.auth));
    return respuesta.json({ planilla });
}

// POST /api/planillas — genera la quincena para todos los empleados que trabajaron el período completo.
// Repetirla no duplica: los empleados ya incluidos se devuelven sin recalcular.
export async function generarPlanilla(peticion, respuesta) {
    const { anio, mes, quincena, inicio, fin } = leerPeriodo(peticion.body);

    const resultado = await ejecutarTransaccion(async (tx) => {
        const candidatos = await tx.empleado.findMany({ orderBy: { id: 'asc' } });
        const incluidos = [];
        const excluidos = [];
        for (const empleado of candidatos) {
            const laboroCompleto = empleado.activo && empleado.fechaIngreso <= inicio &&
                (!empleado.fechaSalida || empleado.fechaSalida >= fin);
            if (!laboroCompleto) {
                excluidos.push({ empleadoId: empleado.id, nombre: empleado.nombreCompleto, motivo: 'No laboró la quincena completa o está inactivo' });
                continue;
            }
            const { creado } = await registrarPlanillaQuincenal(tx, { empleadoId: empleado.id, anio, mes, quincena });
            incluidos.push({ empleadoId: empleado.id, creado });
        }
        if (!incluidos.length) throw new ErrorHttp(409, 'Ningún empleado activo laboró la quincena completa', { excluidos });

        const planilla = await tx.planilla.findUniqueOrThrow({
            where: { periodoInicio_periodoFin: { periodoInicio: inicio, periodoFin: fin } },
        });
        return { planillaId: planilla.id, nuevos: incluidos.filter(i => i.creado).length, excluidos };
    });

    const planilla = await cargarPlanilla(resultado.planillaId);
    return respuesta
        .status(resultado.nuevos ? 201 : 200)
        .location(`/api/planillas/${resultado.planillaId}`)
        .json({ planilla, nuevos: resultado.nuevos, excluidos: resultado.excluidos });
}

// POST /api/planillas/simulacion — calcula descuentos sin guardar (útil en la defensa y en el formulario).
export function simularPlanilla(peticion, respuesta) {
    const salario = decimal(peticion.body?.salarioMensual, 'El salario mensual');
    const quincena = enteroPositivo(peticion.body?.quincena ?? 1, 'La quincena');
    try {
        return respuesta.json({ salarioMensual: salario, quincena, ...calcular_planilla_empleado(salario, quincena) });
    } catch (error) {
        if (error instanceof RangeError) throw new ErrorHttp(400, error.message);
        throw error;
    }
}
