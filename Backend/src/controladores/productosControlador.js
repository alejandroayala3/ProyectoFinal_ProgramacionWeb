import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';
import { enteroPositivo } from '../utils/validacion.js';

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

// GET /api/productos/:id — incluye la receta (insumos que descuenta cada porción).
export async function obtenerProducto(peticion, respuesta) {
    const producto = await prisma.producto.findUnique({
        where: { id: enteroPositivo(peticion.params.id, 'El id del producto') },
        include: {
            categoria: { select: { id: true, nombre: true } },
            insumoReventa: { select: { id: true, codigo: true, nombre: true, unidadBase: true } },
            recetas: { include: { insumo: { select: { id: true, codigo: true, nombre: true, unidadBase: true } } } },
        },
    });
    if (!producto) throw new ErrorHttp(404, 'El producto no existe');
    return respuesta.json({ producto });
}
