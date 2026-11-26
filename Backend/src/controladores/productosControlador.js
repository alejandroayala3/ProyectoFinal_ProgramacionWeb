import prisma from '../config/prisma.js';

export async function listarProductos(_peticion, respuesta) {
    const productos = await prisma.producto.findMany({
        where: { activo: true, categoria: { activo: true } },
        select: {
            id: true,
            codigo: true,
            nombre: true,
            descripcion: true,
            tipo: true,
            precioVenta: true,
            categoria: { select: { id: true, nombre: true } },
        },
        orderBy: [{ categoria: { nombre: 'asc' } }, { nombre: 'asc' }, { id: 'asc' }],
    });

    return respuesta.json({ productos });
}
