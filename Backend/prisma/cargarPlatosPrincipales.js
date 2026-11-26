import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const nombreCategoria = 'Platos principales';
const insumos = {
    'INS-PECHUGA-POLLO': { nombre: 'Pechuga de pollo', unidadBase: 'g' },
    'INS-ACEITE': { nombre: 'Aceite', unidadBase: 'ml' },
    'INS-SAL': { nombre: 'Sal', unidadBase: 'g' },
    'INS-PIMIENTA': { nombre: 'Pimienta', unidadBase: 'g' },
    'INS-MANTEQUILLA': { nombre: 'Mantequilla', unidadBase: 'g' },
    'INS-AJO': { nombre: 'Ajo', unidadBase: 'g' },
    'INS-LOMO-CERDO': { nombre: 'Lomo de cerdo', unidadBase: 'g' },
    'INS-FILETE-PESCADO': { nombre: 'Filete de pescado', unidadBase: 'g' },
};

const platos = [
    {
        codigo: 'PRI-POLLO-PARRILLA',
        nombre: 'Pollo a la parrilla',
        precio: '7.00',
        receta: { 'INS-PECHUGA-POLLO': 200, 'INS-ACEITE': 10, 'INS-SAL': 2, 'INS-PIMIENTA': 1 },
    },
    {
        codigo: 'PRI-POLLO-AJILLO',
        nombre: 'Pollo al ajillo',
        precio: '7.50',
        receta: { 'INS-PECHUGA-POLLO': 200, 'INS-MANTEQUILLA': 15, 'INS-AJO': 5, 'INS-SAL': 2 },
    },
    {
        codigo: 'PRI-LOMO-CERDO-PARRILLA',
        nombre: 'Lomo de cerdo a la parrilla',
        precio: '8.00',
        receta: { 'INS-LOMO-CERDO': 200, 'INS-ACEITE': 10, 'INS-SAL': 2, 'INS-PIMIENTA': 1 },
    },
    {
        codigo: 'PRI-PESCADO-PLANCHA',
        nombre: 'Pescado a la plancha',
        precio: '8.00',
        receta: { 'INS-FILETE-PESCADO': 200, 'INS-MANTEQUILLA': 15, 'INS-AJO': 3, 'INS-SAL': 2 },
    },
];

class ConflictoCarga extends Error {}

async function cargarRegistro(tabla, datos, identificador, creados, contador) {
    const candidatos = await tabla.findMany({ where: identificador, take: 2 });
    if (candidatos.length === 0) {
        const creado = await tabla.create({ data: datos });
        creados[contador]++;
        return creado;
    }

    const etiqueta = datos.codigo ? `${datos.nombre} (${datos.codigo})` : datos.nombre;
    if (candidatos.length > 1) {
        throw new ConflictoCarga(`Conflicto en ${etiqueta}: hay más de un registro con ese código o nombre.`);
    }

    const [actual] = candidatos;
    for (const [campo, esperado] of Object.entries(datos)) {
        const coincide = Prisma.Decimal.isDecimal(esperado) ? esperado.equals(actual[campo]) : actual[campo] === esperado;
        if (!coincide) {
            throw new ConflictoCarga(`Conflicto en ${etiqueta}: el campo ${campo} difiere de la carga inicial.`);
        }
    }
    return actual;
}

async function cargarPlatosPrincipales() {
    const destino = confirmarCargaDemo();

    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);

        const creados = { categorias: 0, productos: 0, insumos: 0, filasReceta: 0 };
        const categoria = await cargarRegistro(
            tx.categoria, { nombre: nombreCategoria, activo: true }, { nombre: nombreCategoria }, creados, 'categorias',
        );

        const idPorCodigo = new Map();
        for (const [codigo, { nombre, unidadBase }] of Object.entries(insumos)) {
            const insumo = await cargarRegistro(tx.insumo, { codigo, nombre, unidadBase, activo: true },
                { OR: [{ codigo }, { nombre }] }, creados, 'insumos');
            idPorCodigo.set(codigo, insumo.id);
        }

        const productoIds = [];
        for (const { codigo, nombre, precio, receta } of platos) {
            const producto = await cargarRegistro(tx.producto, {
                codigo,
                nombre,
                tipo: 'elaborado',
                categoriaId: categoria.id,
                precioVenta: new Prisma.Decimal(precio),
                insumoReventaId: null,
                activo: true,
            }, { OR: [{ codigo }, { nombre }] }, creados, 'productos');
            productoIds.push(producto.id);

            const cantidades = new Map(
                Object.entries(receta).map(([codigoInsumo, cantidad]) => [idPorCodigo.get(codigoInsumo), cantidad]),
            );
            const actuales = await tx.receta.findMany({
                where: { productoId: producto.id },
                select: { insumoId: true, cantidad: true, insumo: { select: { codigo: true } } },
            });
            for (const fila of actuales) {
                const cantidad = cantidades.get(fila.insumoId);
                if (cantidad === undefined || !fila.cantidad.equals(cantidad)) {
                    throw new ConflictoCarga(`Conflicto en la receta de ${nombre} con ${fila.insumo.codigo}: ingrediente o cantidad distintos.`);
                }
                cantidades.delete(fila.insumoId);
            }

            if (cantidades.size > 0) {
                const { count } = await tx.receta.createMany({
                    data: Array.from(cantidades, ([insumoId, cantidad]) => ({
                        productoId: producto.id,
                        tipoProducto: 'elaborado',
                        insumoId,
                        cantidad,
                    })),
                });
                creados.filasReceta += count;
            }
        }

        const categorias = await tx.categoria.count({ where: { nombre: nombreCategoria } });
        const productos = await tx.producto.count({ where: { id: { in: productoIds }, categoriaId: categoria.id } });
        const filasReceta = await tx.receta.count({ where: { productoId: { in: productoIds } } });
        if (categorias !== 1 || productos !== 4 || filasReceta !== 16) {
            throw new ConflictoCarga('Los conteos de los platos principales no coinciden con los esperados.');
        }

        return { destino: destino.destino, creados, verificados: { categorias, productos, filasReceta } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarPlatosPrincipales(), null, 2));
} catch (error) {
    if (error instanceof ErrorCargaDemo || error instanceof ConflictoCarga) {
        console.error(error.message);
    } else if (error.code === 'P2002' || error.code === 'P2034') {
        console.error(`La carga se revirtió por un conflicto de datos o concurrencia (${error.code}). Puedes volver a ejecutarla.`);
    } else {
        console.error(`No se completó la carga. Revisa Prisma y la conexión (${error.code ?? error.name}).`);
    }
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
