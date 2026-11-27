import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { ejecutarTransaccion } from '../utils/transaccion.js';
import { filtroSucursal, sucursalOperacion } from '../utils/alcanceSucursal.js';
import {
    booleanoOpcional, decimal, enteroPositivo, limite, opcion, textoRequerido,
} from '../utils/validacion.js';
import { ajustarExistencia } from '../services/inventario.service.js';

const unidades = ['g', 'ml', 'unidad'];

// Traduce un error de Prisma conocido a un mensaje de negocio; cualquier otro error se relanza igual.
function traducirErrorPrisma(error, mapa) {
    const traduccion = mapa[error?.code];
    if (traduccion) throw new ErrorHttp(traduccion.codigoHttp, traduccion.mensaje);
    throw error;
}

// ----- Insumos -----

// GET /api/inventario/insumos?activo=
export async function listarInsumos(peticion, respuesta) {
    const activo = booleanoOpcional(peticion.query.activo, 'El filtro activo');
    const insumos = await prisma.insumo.findMany({
        where: { activo: activo ?? undefined },
        orderBy: { nombre: 'asc' },
    });
    return respuesta.json({ insumos });
}

// POST /api/inventario/insumos — crea el insumo con existencia 0 en cada sucursal activa.
export async function crearInsumo(peticion, respuesta) {
    const cuerpo = peticion.body ?? {};
    const datos = {
        codigo: textoRequerido(cuerpo.codigo, 30, 'El código'),
        nombre: textoRequerido(cuerpo.nombre, 120, 'El nombre'),
        unidadBase: opcion(cuerpo.unidadBase, unidades, 'La unidad base'),
    };
    const cantidadMinima = cuerpo.cantidadMinima === undefined ? new Prisma.Decimal(0)
        : decimal(cuerpo.cantidadMinima, 'La cantidad mínima', { decimales: 3, permiteCero: true });

    let insumo;
    try {
        insumo = await ejecutarTransaccion(async (tx) => {
            const creado = await tx.insumo.create({ data: datos });
            const sucursales = await tx.sucursal.findMany({ where: { activo: true }, select: { id: true } });
            await tx.existenciaSucursal.createMany({
                data: sucursales.map(({ id }) => ({ sucursalId: id, insumoId: creado.id, cantidadMinima })),
            });
            return creado;
        });
    } catch (error) {
        traducirErrorPrisma(error, {
            P2002: { codigoHttp: 409, mensaje: 'Ya existe un insumo con ese código' },
        });
    }
    return respuesta.status(201).json({ insumo });
}

// PATCH /api/inventario/insumos/:id — nombre o estado (la unidad no cambia: rompería recetas y saldos).
export async function actualizarInsumo(peticion, respuesta) {
    const datos = {};
    if (peticion.body?.nombre !== undefined) datos.nombre = textoRequerido(peticion.body.nombre, 120, 'El nombre');
    const activo = booleanoOpcional(peticion.body?.activo, 'El estado activo');
    if (activo !== null) datos.activo = activo;
    if (!Object.keys(datos).length) throw new ErrorHttp(400, 'No hay datos para actualizar');

    try {
        const insumo = await prisma.insumo.update({
            where: { id: enteroPositivo(peticion.params.id, 'El id del insumo') },
            data: datos,
        });
        return respuesta.json({ insumo });
    } catch (error) {
        return traducirErrorPrisma(error, {
            P2025: { codigoHttp: 404, mensaje: 'El insumo no existe' },
        });
    }
}

// ----- Existencias y alertas -----

// GET /api/inventario/existencias?sucursalId=&bajoMinimo=true
export async function listarExistencias(peticion, respuesta) {
    const bajoMinimo = booleanoOpcional(peticion.query.bajoMinimo, 'El filtro bajoMinimo');
    const existencias = await prisma.existenciaSucursal.findMany({
        where: { sucursalId: filtroSucursal(peticion.auth, peticion.query.sucursalId), insumo: { activo: true } },
        include: {
            sucursal: { select: { nombre: true } },
            insumo: { select: { codigo: true, nombre: true, unidadBase: true } },
        },
        orderBy: [{ sucursalId: 'asc' }, { insumo: { nombre: 'asc' } }],
    });
    const resultado = existencias
        .map(fila => ({ ...fila, bajoMinimo: fila.cantidadActual.lte(fila.cantidadMinima) }))
        .filter(fila => bajoMinimo === null || fila.bajoMinimo === bajoMinimo);
    return respuesta.json({ existencias: resultado });
}

// GET /api/inventario/alertas?sucursalId= — usa la vista v_reporte_alertas_stock.
export async function listarAlertas(peticion, respuesta) {
    const sucursalId = filtroSucursal(peticion.auth, peticion.query.sucursalId);
    const filtro = sucursalId ? Prisma.sql`WHERE sucursal_id = ${sucursalId}` : Prisma.empty;
    const alertas = await prisma.$queryRaw`
        SELECT sucursal_id AS sucursalId, sucursal, insumo_id AS insumoId, insumo, unidad,
               cantidad_actual AS cantidadActual, cantidad_minima AS cantidadMinima
        FROM dbo.v_reporte_alertas_stock
        ${filtro}
        ORDER BY sucursal, insumo
    `;
    return respuesta.json({ total: alertas.length, alertas });
}

// PATCH /api/inventario/existencias/:insumoId — define el stock mínimo que dispara la alerta.
export async function actualizarMinimo(peticion, respuesta) {
    const sucursalId = sucursalOperacion(peticion.auth, peticion.body?.sucursalId);
    const insumoId = enteroPositivo(peticion.params.insumoId, 'El insumo');
    const cantidadMinima = decimal(peticion.body?.cantidadMinima, 'La cantidad mínima', { decimales: 3, permiteCero: true });

    try {
        const existencia = await prisma.existenciaSucursal.update({
            where: { sucursalId_insumoId: { sucursalId, insumoId } },
            data: { cantidadMinima },
        });
        return respuesta.json({ existencia });
    } catch (error) {
        return traducirErrorPrisma(error, {
            P2025: { codigoHttp: 404, mensaje: 'El insumo no tiene existencia en esta sucursal' },
        });
    }
}

// ----- Movimientos -----

// GET /api/inventario/movimientos?sucursalId=&insumoId=&tipo=&limite=
export async function listarMovimientos(peticion, respuesta) {
    const { insumoId, tipo } = peticion.query;
    const movimientos = await prisma.movimientoInventario.findMany({
        where: {
            sucursalId: filtroSucursal(peticion.auth, peticion.query.sucursalId),
            insumoId: insumoId ? enteroPositivo(insumoId, 'El insumo') : undefined,
            tipo: tipo ? opcion(tipo, ['entrada', 'salida', 'ajuste'], 'El tipo') : undefined,
        },
        include: { existencia: { select: { insumo: { select: { nombre: true, unidadBase: true } } } } },
        orderBy: { fecha: 'desc' },
        take: limite(peticion.query.limite, 100, 500),
    });
    return respuesta.json({ movimientos });
}

// POST /api/inventario/ajustes — merma, daño o corrección por conteo físico.
export async function crearAjuste(peticion, respuesta) {
    const cuerpo = peticion.body ?? {};
    const cantidadCambio = decimal(cuerpo.cantidadCambio, 'La cantidad del ajuste', { decimales: 3, permiteNegativo: true });
    const movimiento = await ejecutarTransaccion(tx => ajustarExistencia(tx, {
        sucursalId: sucursalOperacion(peticion.auth, cuerpo.sucursalId),
        insumoId: enteroPositivo(cuerpo.insumoId, 'El insumo'),
        cantidadCambio,
        motivo: textoRequerido(cuerpo.motivo, 150, 'El motivo'),
    }));
    return respuesta.status(201).json({ movimiento });
}