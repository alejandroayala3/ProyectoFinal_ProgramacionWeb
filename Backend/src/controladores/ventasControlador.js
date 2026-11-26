import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { ejecutarTransaccion } from '../utils/transaccion.js';
import { filtroSucursal, sucursalOperacion, verificarAccesoTurno, verificarSucursal } from '../utils/alcanceSucursal.js';
import { arreglo, decimal, enteroOpcional, enteroPositivo, limite, opcion, rangoFechas } from '../utils/validacion.js';
import { registrarVenta } from '../services/venta.service.js';
import { emitirDocumentoVenta } from '../services/facturacion.service.js';
import { registrarCobro } from '../services/caja.service.js';

const metodosPago = ['efectivo', 'tarjeta', 'digital'];
const tiposDocumento = ['consumidor_final', 'ccf'];
const cero = new Prisma.Decimal(0);

const incluirVenta = {
    sucursal: { select: { id: true, nombre: true } },
    usuario: { select: { id: true, nombreCompleto: true } },
    detalles: { include: { producto: { select: { id: true, codigo: true, nombre: true, tipo: true } } } },
    cobros: { orderBy: { fecha: 'asc' } },
    documentos: true,
};

// Da forma a la respuesta: documento único y saldo pendiente de cobro.
function formatearVenta({ documentos, ...venta }) {
    const cobrado = venta.cobros.reduce((suma, cobro) => suma.plus(cobro.monto), cero);
    return { ...venta, documento: documentos[0] ?? null, cobrado, saldoPendiente: venta.total.minus(cobrado) };
}

// Une líneas repetidas del mismo producto (la tabla exige una línea por producto).
function normalizarLineas(lineas) {
    const porProducto = new Map();
    arreglo(lineas, 'Las líneas de la venta', { maximo: 50 }).forEach((linea, indice) => {
        const productoId = enteroPositivo(linea?.productoId, `El producto de la línea ${indice + 1}`);
        const cantidad = enteroPositivo(linea?.cantidad, `La cantidad de la línea ${indice + 1}`);
        if (cantidad > 999) throw new ErrorHttp(400, `La cantidad de la línea ${indice + 1} es demasiado alta`);
        porProducto.set(productoId, (porProducto.get(productoId) ?? 0) + cantidad);
    });
    return [...porProducto].map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

function normalizarPagos(pagos) {
    if (pagos === undefined || pagos === null) return [];
    return arreglo(pagos, 'Los pagos', { minimo: 0, maximo: 5 }).map((pago, indice) => ({
        metodo: opcion(pago?.metodo, metodosPago, `El método del pago ${indice + 1}`),
        monto: decimal(pago?.monto, `El monto del pago ${indice + 1}`),
    }));
}

async function cargarVenta(id) {
    const venta = await prisma.venta.findUnique({ where: { id }, include: incluirVenta });
    if (!venta) throw new ErrorHttp(404, 'La venta no existe');
    return formatearVenta(venta);
}

// GET /api/ventas?sucursalId=&desde=&hasta=&limite=
export async function listarVentas(peticion, respuesta) {
    const { sucursalId, desde, hasta } = peticion.query;
    const ventas = await prisma.venta.findMany({
        where: { sucursalId: filtroSucursal(peticion.auth, sucursalId), fecha: rangoFechas(desde, hasta) },
        include: {
            sucursal: { select: { nombre: true } },
            usuario: { select: { nombreCompleto: true } },
            documentos: { select: { tipoDocumento: true, correlativo: true } },
            _count: { select: { detalles: true } },
        },
        orderBy: { fecha: 'desc' },
        take: limite(peticion.query.limite),
    });
    return respuesta.json({ ventas });
}

// GET /api/ventas/:id
export async function obtenerVenta(peticion, respuesta) {
    const venta = await cargarVenta(enteroPositivo(peticion.params.id, 'El id de la venta'));
    verificarSucursal(peticion.auth, venta.sucursalId);
    return respuesta.json({ venta });
}

// POST /api/ventas — flujo completo del POS en una sola transacción:
// venta + descuento de inventario + documento fiscal + cobros (opcionales).
// Si cualquier paso falla (p. ej. falta stock), no se guarda nada.
export async function crearVenta(peticion, respuesta) {
    const cuerpo = peticion.body ?? {};
    const sucursalId = sucursalOperacion(peticion.auth, cuerpo.sucursalId);
    const lineas = normalizarLineas(cuerpo.lineas);
    const tipoDocumento = opcion(cuerpo.tipoDocumento ?? 'consumidor_final', tiposDocumento, 'El tipo de documento');
    const clienteId = enteroOpcional(cuerpo.clienteId, 'El cliente');
    const pagos = normalizarPagos(cuerpo.pagos);
    const turnoId = enteroOpcional(cuerpo.turnoId, 'El turno');
    if (pagos.length && !turnoId) throw new ErrorHttp(400, 'Para cobrar la venta indica el turno de caja abierto');

    const ventaId = await ejecutarTransaccion(async (tx) => {
        if (turnoId) {
            verificarAccesoTurno(peticion.auth, await tx.turnoCaja.findUnique({ where: { id: turnoId } }));
        }
        const venta = await registrarVenta(tx, {
            referencia: `V-${randomUUID()}`,
            sucursalId,
            usuarioId: peticion.auth.idUsuario,
            lineas,
        });
        await emitirDocumentoVenta(tx, { ventaId: venta.id, tipoDocumento, clienteId });
        for (const pago of pagos) {
            await registrarCobro(tx, { ...pago, referencia: `COBRO-${randomUUID()}`, turnoId, ventaId: venta.id });
        }
        return venta.id;
    });

    const venta = await cargarVenta(ventaId);
    return respuesta.status(201).location(`/api/ventas/${ventaId}`).json({ mensaje: 'Venta registrada', venta });
}
