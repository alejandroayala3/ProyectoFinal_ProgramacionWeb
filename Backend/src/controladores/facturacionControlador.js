import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { ejecutarTransaccion } from '../utils/transaccion.js';
import { filtroSucursal, verificarSucursal } from '../utils/alcanceSucursal.js';
import { enteroOpcional, enteroPositivo, limite, opcion, rangoFechas } from '../utils/validacion.js';
import { emitirDocumentoVenta } from '../services/facturacion.service.js';

const tiposDocumento = ['consumidor_final', 'ccf'];

// GET /api/documentos?tipo=&sucursalId=&desde=&hasta=
export async function listarDocumentos(peticion, respuesta) {
    const { tipo, sucursalId, desde, hasta } = peticion.query;
    const documentos = await prisma.documentoVenta.findMany({
        where: {
            sucursalId: filtroSucursal(peticion.auth, sucursalId),
            tipoDocumento: tipo ? opcion(tipo, tiposDocumento, 'El tipo') : undefined,
            fecha: rangoFechas(desde, hasta),
        },
        orderBy: [{ fecha: 'desc' }, { correlativo: 'desc' }],
        take: limite(peticion.query.limite),
    });
    return respuesta.json({ documentos });
}

// GET /api/documentos/:id — todo lo necesario para imprimir la factura o el CCF.
export async function obtenerDocumento(peticion, respuesta) {
    const documento = await prisma.documentoVenta.findUnique({
        where: { id: enteroPositivo(peticion.params.id, 'El id del documento') },
        include: {
            venta: {
                include: {
                    sucursal: { select: { nombre: true } },
                    detalles: { include: { producto: { select: { codigo: true, nombre: true } } } },
                },
            },
        },
    });
    if (!documento) throw new ErrorHttp(404, 'El documento no existe');
    verificarSucursal(peticion.auth, documento.sucursalId);
    return respuesta.json({ documento });
}

// POST /api/ventas/:id/documento — factura una venta que se registró sin documento.
// Si ya tenía el mismo documento, lo devuelve sin crear otro (200 en vez de 201).
export async function emitirDocumento(peticion, respuesta) {
    const ventaId = enteroPositivo(peticion.params.id, 'El id de la venta');
    const tipoDocumento = opcion(peticion.body?.tipoDocumento, tiposDocumento, 'El tipo de documento');
    const clienteId = enteroOpcional(peticion.body?.clienteId, 'El cliente');

    const venta = await prisma.venta.findUnique({ where: { id: ventaId }, select: { sucursalId: true } });
    if (!venta) throw new ErrorHttp(404, 'La venta no existe');
    verificarSucursal(peticion.auth, venta.sucursalId);

    const { creado, documento } = await ejecutarTransaccion(tx =>
        emitirDocumentoVenta(tx, { ventaId, tipoDocumento, clienteId }));
    return respuesta.status(creado ? 201 : 200).json({ documento });
}
