import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { ejecutarTransaccion } from '../utils/transaccion.js';
import { filtroSucursal, sucursalOperacion, verificarSucursal } from '../utils/alcanceSucursal.js';
import {
    arreglo, booleanoOpcional, decimal, enteroPositivo, limite, rangoFechas, textoOpcional, textoRequerido,
} from '../utils/validacion.js';
import { registrarCompra, registrarPagoCompra } from '../services/compra.service.js';

const cero = new Prisma.Decimal(0);

function normalizarPago(pago, etiqueta) {
    return {
        metodo: textoRequerido(pago?.metodo, 30, `El método de ${etiqueta}`),
        monto: decimal(pago?.monto, `El monto de ${etiqueta}`),
        referencia: textoOpcional(pago?.referencia, 60, `La referencia de ${etiqueta}`),
    };
}

// Agrega lo pagado y el saldo (cuenta por pagar) a cada compra.
function conSaldo({ pagos, ...compra }) {
    const pagado = pagos.reduce((suma, pago) => suma.plus(pago.monto), cero);
    return { ...compra, pagos, pagado, saldo: compra.total.minus(pagado) };
}

// ----- Proveedores -----

// GET /api/proveedores?activo=
export async function listarProveedores(peticion, respuesta) {
    const activo = booleanoOpcional(peticion.query.activo, 'El filtro activo');
    const proveedores = await prisma.proveedor.findMany({
        where: { activo: activo ?? undefined },
        orderBy: { nombre: 'asc' },
    });
    return respuesta.json({ proveedores });
}

// POST /api/proveedores
export async function crearProveedor(peticion, respuesta) {
    const proveedor = await prisma.proveedor.create({
        data: {
            codigo: textoRequerido(peticion.body?.codigo, 30, 'El código'),
            nombre: textoRequerido(peticion.body?.nombre, 150, 'El nombre'),
        },
    });
    return respuesta.status(201).json({ proveedor });
}

// PATCH /api/proveedores/:id
export async function actualizarProveedor(peticion, respuesta) {
    const datos = {};
    if (peticion.body?.nombre !== undefined) datos.nombre = textoRequerido(peticion.body.nombre, 150, 'El nombre');
    const activo = booleanoOpcional(peticion.body?.activo, 'El estado activo');
    if (activo !== null) datos.activo = activo;
    if (!Object.keys(datos).length) throw new ErrorHttp(400, 'No hay datos para actualizar');
    const proveedor = await prisma.proveedor.update({
        where: { id: enteroPositivo(peticion.params.id, 'El id del proveedor') },
        data: datos,
    });
    return respuesta.json({ proveedor });
}

// ----- Compras y cuentas por pagar -----

// GET /api/compras?sucursalId=&proveedorId=&pendientes=true&desde=&hasta=
export async function listarCompras(peticion, respuesta) {
    const { sucursalId, proveedorId, desde, hasta } = peticion.query;
    const pendientes = booleanoOpcional(peticion.query.pendientes, 'El filtro pendientes');
    const compras = await prisma.compra.findMany({
        where: {
            sucursalId: filtroSucursal(peticion.auth, sucursalId),
            proveedorId: proveedorId ? enteroPositivo(proveedorId, 'El proveedor') : undefined,
            fecha: rangoFechas(desde, hasta),
        },
        include: {
            proveedor: { select: { id: true, nombre: true } },
            sucursal: { select: { nombre: true } },
            pagos: { select: { monto: true } },
        },
        orderBy: { fecha: 'desc' },
        take: limite(peticion.query.limite),
    });
    const resultado = compras.map(conSaldo).filter(compra => !pendientes || compra.saldo.gt(0));
    return respuesta.json({ compras: resultado });
}

async function cargarCompra(id) {
    const compra = await prisma.compra.findUnique({
        where: { id },
        include: {
            proveedor: true,
            sucursal: { select: { id: true, nombre: true } },
            detalles: { include: { insumo: { select: { codigo: true, nombre: true, unidadBase: true } } } },
            pagos: { orderBy: { fecha: 'asc' } },
        },
    });
    if (!compra) throw new ErrorHttp(404, 'La compra no existe');
    return conSaldo(compra);
}

// GET /api/compras/:id
export async function obtenerCompra(peticion, respuesta) {
    const compra = await cargarCompra(enteroPositivo(peticion.params.id, 'El id de la compra'));
    verificarSucursal(peticion.auth, compra.sucursalId);
    return respuesta.json({ compra });
}

// POST /api/compras — factura del proveedor: suma inventario y deja el saldo por pagar.
export async function crearCompra(peticion, respuesta) {
    const cuerpo = peticion.body ?? {};
    const sucursalId = sucursalOperacion(peticion.auth, cuerpo.sucursalId);
    const detalles = arreglo(cuerpo.detalles, 'Los detalles de la compra', { maximo: 100 }).map((detalle, indice) => ({
        insumoId: enteroPositivo(detalle?.insumoId, `El insumo de la línea ${indice + 1}`),
        cantidad: decimal(detalle?.cantidad, `La cantidad de la línea ${indice + 1}`, { decimales: 3 }),
        costoUnitario: decimal(detalle?.costoUnitario, `El costo unitario de la línea ${indice + 1}`, { decimales: 6, permiteCero: true }),
    }));
    if (new Set(detalles.map(d => d.insumoId)).size !== detalles.length) {
        throw new ErrorHttp(400, 'Cada insumo debe aparecer una sola vez en la compra');
    }
    const pagos = (cuerpo.pagos === undefined ? [] : arreglo(cuerpo.pagos, 'Los pagos', { minimo: 0, maximo: 10 }))
        .map((pago, indice) => normalizarPago(pago, `el pago ${indice + 1}`));

    const { id } = await ejecutarTransaccion(tx => registrarCompra(tx, {
        proveedorId: enteroPositivo(cuerpo.proveedorId, 'El proveedor'),
        sucursalId,
        numeroFactura: textoRequerido(cuerpo.numeroFactura, 50, 'El número de factura'),
        detalles,
        pagos,
    }));
    return respuesta.status(201).location(`/api/compras/${id}`).json({ compra: await cargarCompra(id) });
}

// POST /api/compras/:id/pagos — abono a la cuenta por pagar.
export async function crearPagoCompra(peticion, respuesta) {
    const compraId = enteroPositivo(peticion.params.id, 'El id de la compra');
    const compra = await prisma.compra.findUnique({ where: { id: compraId }, select: { sucursalId: true } });
    if (!compra) throw new ErrorHttp(404, 'La compra no existe');
    verificarSucursal(peticion.auth, compra.sucursalId);

    const pago = await ejecutarTransaccion(tx =>
        registrarPagoCompra(tx, { compraId, ...normalizarPago(peticion.body, 'el pago') }));
    return respuesta.status(201).json({ pago });
}
