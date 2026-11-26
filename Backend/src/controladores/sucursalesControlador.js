import prisma from '../config/prisma.js';

// GET /api/sucursales — para los selectores del frontend.
export async function listarSucursales(_peticion, respuesta) {
    const sucursales = await prisma.sucursal.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } });
    return respuesta.json({ sucursales });
}
