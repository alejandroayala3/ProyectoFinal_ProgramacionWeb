import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { booleanoOpcional, enteroPositivo, limite, textoOpcional, textoRequerido } from '../utils/validacion.js';

// NIT y NRC salvadoreños: solo dígitos y guiones (p. ej. 0614-010190-101-1, 123456-7).
function documentoFiscal(valor, etiqueta) {
    const texto = textoOpcional(valor, 25, etiqueta);
    if (texto && !/^\d[\d-]*\d$/.test(texto)) {
        throw new ErrorHttp(400, `${etiqueta} solo admite dígitos y guiones`);
    }
    return texto;
}

function datosCliente(cuerpo, parcial) {
    const datos = {};
    if (!parcial || cuerpo.nombre !== undefined) datos.nombre = textoRequerido(cuerpo.nombre, 150, 'El nombre');
    if (!parcial || cuerpo.razonSocial !== undefined) datos.razonSocial = textoOpcional(cuerpo.razonSocial, 150, 'La razón social');
    if (!parcial || cuerpo.nit !== undefined) datos.nit = documentoFiscal(cuerpo.nit, 'El NIT');
    if (!parcial || cuerpo.nrc !== undefined) datos.nrc = documentoFiscal(cuerpo.nrc, 'El NRC');
    const activo = booleanoOpcional(cuerpo.activo, 'El estado activo');
    if (activo !== null) datos.activo = activo;
    return datos;
}

// Indica al POS si el cliente ya puede recibir un CCF.
function conAptitudCcf(cliente) {
    return { ...cliente, aptoCcf: Boolean(cliente.activo && cliente.razonSocial && cliente.nit && cliente.nrc) };
}

// GET /api/clientes?buscar=&activo=
export async function listarClientes(peticion, respuesta) {
    const buscar = textoOpcional(peticion.query.buscar, 60, 'La búsqueda');
    const activo = booleanoOpcional(peticion.query.activo, 'El filtro activo');
    const clientes = await prisma.cliente.findMany({
        where: {
            activo: activo ?? undefined,
            OR: buscar ? [
                { nombre: { contains: buscar } },
                { razonSocial: { contains: buscar } },
                { nit: { contains: buscar } },
                { nrc: { contains: buscar } },
            ] : undefined,
        },
        orderBy: { nombre: 'asc' },
        take: limite(peticion.query.limite),
    });
    return respuesta.json({ clientes: clientes.map(conAptitudCcf) });
}

// GET /api/clientes/:id
export async function obtenerCliente(peticion, respuesta) {
    const cliente = await prisma.cliente.findUnique({ where: { id: enteroPositivo(peticion.params.id, 'El id del cliente') } });
    if (!cliente) throw new ErrorHttp(404, 'El cliente no existe');
    return respuesta.json({ cliente: conAptitudCcf(cliente) });
}

// POST /api/clientes
export async function crearCliente(peticion, respuesta) {
    const cliente = await prisma.cliente.create({ data: datosCliente(peticion.body ?? {}, false) });
    return respuesta.status(201).location(`/api/clientes/${cliente.id}`).json({ cliente: conAptitudCcf(cliente) });
}

// PATCH /api/clientes/:id — los documentos ya emitidos conservan los datos anteriores.
export async function actualizarCliente(peticion, respuesta) {
    const id = enteroPositivo(peticion.params.id, 'El id del cliente');
    const datos = datosCliente(peticion.body ?? {}, true);
    if (!Object.keys(datos).length) throw new ErrorHttp(400, 'No hay datos para actualizar');
    const cliente = await prisma.cliente.update({ where: { id }, data: datos });
    return respuesta.json({ cliente: conAptitudCcf(cliente) });
}
