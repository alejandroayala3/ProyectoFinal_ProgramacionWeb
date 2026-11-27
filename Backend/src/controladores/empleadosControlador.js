import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { esAdmin, filtroSucursal, sucursalOperacion, verificarSucursal } from '../utils/alcanceSucursal.js';
import {
    booleanoOpcional, decimal, enteroOpcional, enteroPositivo, fecha, opcion, textoRequerido,
} from '../utils/validacion.js';

const cargos = ['barista', 'cajero', 'gerente'];

const incluirEmpleado = {
    sucursal: { select: { id: true, nombre: true } },
    usuario: { select: { id: true, correo: true } },
};

async function cargarEmpleado(peticion) {
    const empleado = await prisma.empleado.findUnique({
        where: { id: enteroPositivo(peticion.params.id, 'El id del empleado') },
        include: incluirEmpleado,
    });
    if (!empleado) throw new ErrorHttp(404, 'El empleado no existe');
    verificarSucursal(peticion.auth, empleado.sucursalId);
    return empleado;
}

// Valida solo los campos presentes (POST exige todos los obligatorios, PATCH acepta parciales).
function datosEmpleado(peticion, parcial) {
    const cuerpo = peticion.body ?? {};
    const datos = {};
    const presente = campo => !parcial || cuerpo[campo] !== undefined;

    if (!parcial) datos.codigo = textoRequerido(cuerpo.codigo, 30, 'El código');
    if (presente('nombreCompleto')) datos.nombreCompleto = textoRequerido(cuerpo.nombreCompleto, 150, 'El nombre completo');
    if (presente('cargo')) datos.cargo = opcion(cuerpo.cargo, cargos, 'El cargo');
    if (presente('salarioMensual')) datos.salarioMensual = decimal(cuerpo.salarioMensual, 'El salario mensual');
    if (presente('fechaIngreso')) datos.fechaIngreso = fecha(cuerpo.fechaIngreso, 'La fecha de ingreso');
    if (cuerpo.fechaSalida !== undefined) {
        datos.fechaSalida = cuerpo.fechaSalida === null ? null : fecha(cuerpo.fechaSalida, 'La fecha de salida');
    }
    if (cuerpo.usuarioId !== undefined) datos.usuarioId = enteroOpcional(cuerpo.usuarioId, 'El usuario');
    if (presente('sucursalId') && (!parcial || esAdmin(peticion.auth))) {
        datos.sucursalId = sucursalOperacion(peticion.auth, cuerpo.sucursalId);
    }
    const activo = booleanoOpcional(cuerpo.activo, 'El estado activo');
    if (activo !== null) datos.activo = activo;
    return datos;
}

// GET /api/empleados?sucursalId=&cargo=&activo=
export async function listarEmpleados(peticion, respuesta) {
    const { cargo } = peticion.query;
    const activo = booleanoOpcional(peticion.query.activo, 'El filtro activo');
    const empleados = await prisma.empleado.findMany({
        where: {
            sucursalId: filtroSucursal(peticion.auth, peticion.query.sucursalId),
            cargo: cargo ? opcion(cargo, cargos, 'El cargo') : undefined,
            activo: activo ?? undefined,
        },
        include: incluirEmpleado,
        orderBy: { nombreCompleto: 'asc' },
    });
    return respuesta.json({ empleados });
}

// GET /api/empleados/:id — incluye su historial de planillas.
export async function obtenerEmpleado(peticion, respuesta) {
    const empleado = await cargarEmpleado(peticion);
    const planillas = await prisma.detallePlanilla.findMany({
        where: { empleadoId: empleado.id },
        include: { planilla: { select: { periodoInicio: true, periodoFin: true } } },
        orderBy: { planilla: { periodoInicio: 'desc' } },
    });
    return respuesta.json({ empleado: { ...empleado, planillas } });
}

// POST /api/empleados
export async function crearEmpleado(peticion, respuesta) {
    const datos = datosEmpleado(peticion, false);
    datos.sucursalId ??= sucursalOperacion(peticion.auth, undefined);
    const empleado = await prisma.empleado.create({ data: datos, include: incluirEmpleado });
    return respuesta.status(201).location(`/api/empleados/${empleado.id}`).json({ empleado });
}

// PATCH /api/empleados/:id — para dar de baja: { "activo": false, "fechaSalida": "AAAA-MM-DD" }.
export async function actualizarEmpleado(peticion, respuesta) {
    const actual = await cargarEmpleado(peticion);
    const datos = datosEmpleado(peticion, true);
    if (!Object.keys(datos).length) throw new ErrorHttp(400, 'No hay datos para actualizar');
    const empleado = await prisma.empleado.update({ where: { id: actual.id }, data: datos, include: incluirEmpleado });
    return respuesta.json({ empleado });
}
