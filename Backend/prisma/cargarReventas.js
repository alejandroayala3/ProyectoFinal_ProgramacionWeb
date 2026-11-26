import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const nombreCategoria = 'Bebidas envasadas';
const reventas = [
    {
        codigo: 'REV-AGUA-500-ML',
        nombre: 'Agua embotellada 500 ml',
        precio: '1.50',
        codigoInsumo: 'INS-AGUA-EMBOTELLADA-500-ML',
    },
    {
        codigo: 'REV-GASEOSA-355-ML',
        nombre: 'Gaseosa en lata 355 ml',
        precio: '1.75',
        codigoInsumo: 'INS-GASEOSA-LATA-355-ML',
    },
];

class ConflictoCarga extends Error {}

async function cargarRegistro(tabla, datos, filtro, creados, contador) {
    const candidatos = await tabla.findMany({ where: filtro, take: 2 });
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

async function cargarReventas() {
    const destino = confirmarCargaDemo();

    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);

        const creados = { categorias: 0, productos: 0, insumos: 0 };
        const categoria = await cargarRegistro(tx.categoria, { nombre: nombreCategoria, activo: true },
            { nombre: nombreCategoria }, creados, 'categorias');

        const verificados = [];
        for (const { codigo, nombre, precio, codigoInsumo } of reventas) {
            const insumo = await cargarRegistro(tx.insumo, {
                codigo: codigoInsumo, nombre, unidadBase: 'unidad', activo: true,
            }, { OR: [{ codigo: codigoInsumo }, { nombre }] }, creados, 'insumos');

            const producto = await cargarRegistro(tx.producto, {
                codigo,
                nombre,
                tipo: 'reventa',
                categoriaId: categoria.id,
                precioVenta: new Prisma.Decimal(precio),
                insumoReventaId: insumo.id,
                activo: true,
            }, { OR: [{ codigo }, { nombre }] }, creados, 'productos');

            const filasReceta = await tx.receta.count({ where: { productoId: producto.id } });
            if (filasReceta !== 0) {
                throw new ConflictoCarga(`Conflicto en ${nombre}: el producto de reventa tiene filas de receta.`);
            }
            verificados.push({ producto: codigo, insumo: insumo.codigo, unidad: insumo.unidadBase, filasReceta });
        }

        const elaborados = await tx.producto.count({ where: { tipo: 'elaborado' } });
        const reventa = await tx.producto.count({ where: { tipo: 'reventa' } });
        return { destino: destino.destino, creados, verificados, totales: { elaborados, reventa } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarReventas(), null, 2));
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
