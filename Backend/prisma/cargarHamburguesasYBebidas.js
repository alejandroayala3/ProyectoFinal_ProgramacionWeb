import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const insumos = {
    'INS-PAN-HAMBURGUESA': { nombre: 'Pan para hamburguesa', unidadBase: 'unidad' },
    'INS-CARNE-RES-HAMBURGUESA': { nombre: 'Carne de res para hamburguesa', unidadBase: 'g' },
    'INS-LECHUGA': { nombre: 'Lechuga', unidadBase: 'g' },
    'INS-TOMATE': { nombre: 'Tomate', unidadBase: 'g' },
    'INS-SALSA-HAMBURGUESA': { nombre: 'Salsa para hamburguesa comprada', unidadBase: 'g' },
    'INS-CHEDDAR': { nombre: 'Queso cheddar', unidadBase: 'g' },
    'INS-PECHUGA-POLLO': { nombre: 'Pechuga de pollo', unidadBase: 'g' },
    'INS-JUGO-LIMON': { nombre: 'Jugo de limón', unidadBase: 'ml' },
    'INS-AGUA-POTABLE': { nombre: 'Agua potable', unidadBase: 'ml' },
    'INS-AZUCAR': { nombre: 'Azúcar', unidadBase: 'g' },
    'INS-HIERBABUENA': { nombre: 'Hierbabuena', unidadBase: 'g' },
    'INS-JUGO-NARANJA': { nombre: 'Jugo de naranja', unidadBase: 'ml' },
    'INS-CAFE-ESPECIALIDAD': { nombre: 'Café de especialidad', unidadBase: 'g' },
    'INS-LECHE': { nombre: 'Leche', unidadBase: 'ml' },
    'INS-VASO-16-OZ': { nombre: 'Vaso de 16 oz', unidadBase: 'unidad' },
    'INS-TAPADERA-16-OZ': { nombre: 'Tapadera para vaso de 16 oz', unidadBase: 'unidad' },
    'INS-VINETA': { nombre: 'Viñeta', unidadBase: 'unidad' },
};

const categorias = [
    {
        nombre: 'Hamburguesas',
        filasEsperadas: 16,
        productos: [
            {
                codigo: 'HAM-CLASICA',
                nombre: 'Hamburguesa clásica',
                precio: '7.00',
                receta: {
                    'INS-PAN-HAMBURGUESA': 1,
                    'INS-CARNE-RES-HAMBURGUESA': 150,
                    'INS-LECHUGA': 20,
                    'INS-TOMATE': 30,
                    'INS-SALSA-HAMBURGUESA': 15,
                },
            },
            {
                codigo: 'HAM-CON-QUESO',
                nombre: 'Hamburguesa con queso',
                precio: '8.00',
                receta: {
                    'INS-PAN-HAMBURGUESA': 1,
                    'INS-CARNE-RES-HAMBURGUESA': 150,
                    'INS-CHEDDAR': 20,
                    'INS-LECHUGA': 20,
                    'INS-TOMATE': 30,
                    'INS-SALSA-HAMBURGUESA': 15,
                },
            },
            {
                codigo: 'HAM-POLLO',
                nombre: 'Hamburguesa de pollo',
                precio: '7.50',
                receta: {
                    'INS-PAN-HAMBURGUESA': 1,
                    'INS-PECHUGA-POLLO': 150,
                    'INS-LECHUGA': 20,
                    'INS-TOMATE': 30,
                    'INS-SALSA-HAMBURGUESA': 15,
                },
            },
        ],
    },
    {
        nombre: 'Bebidas preparadas',
        filasEsperadas: 15,
        productos: [
            {
                codigo: 'BEB-LIMONADA-NATURAL',
                nombre: 'Limonada natural',
                precio: '2.50',
                receta: { 'INS-JUGO-LIMON': 40, 'INS-AGUA-POTABLE': 250, 'INS-AZUCAR': 20 },
            },
            {
                codigo: 'BEB-LIMONADA-HIERBABUENA',
                nombre: 'Limonada con hierbabuena',
                precio: '3.00',
                receta: { 'INS-JUGO-LIMON': 40, 'INS-AGUA-POTABLE': 250, 'INS-AZUCAR': 20, 'INS-HIERBABUENA': 3 },
            },
            {
                codigo: 'BEB-NARANJADA-NATURAL',
                nombre: 'Naranjada natural',
                precio: '3.00',
                receta: { 'INS-JUGO-NARANJA': 100, 'INS-AGUA-POTABLE': 200, 'INS-AZUCAR': 15 },
            },
            {
                codigo: 'BEB-LATTE-GRANDE',
                nombre: 'Latte Grande',
                precio: '3.50',
                receta: {
                    'INS-CAFE-ESPECIALIDAD': 18,
                    'INS-LECHE': 250,
                    'INS-VASO-16-OZ': 1,
                    'INS-TAPADERA-16-OZ': 1,
                    'INS-VINETA': 1,
                },
            },
        ],
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

async function cargarReceta(tx, producto, receta, idPorCodigo) {
    const cantidades = new Map(
        Object.entries(receta).map(([codigo, cantidad]) => [idPorCodigo.get(codigo), cantidad]),
    );
    const actuales = await tx.receta.findMany({
        where: { productoId: producto.id },
        select: { insumoId: true, cantidad: true, insumo: { select: { codigo: true } } },
    });
    for (const fila of actuales) {
        const cantidad = cantidades.get(fila.insumoId);
        if (cantidad === undefined || !fila.cantidad.equals(cantidad)) {
            throw new ConflictoCarga(
                `Conflicto en la receta de ${producto.nombre} con ${fila.insumo.codigo}: ingrediente o cantidad distintos.`,
            );
        }
        cantidades.delete(fila.insumoId);
    }

    if (cantidades.size === 0) return 0;

    const { count } = await tx.receta.createMany({
        data: Array.from(cantidades, ([insumoId, cantidad]) => ({
            productoId: producto.id,
            tipoProducto: 'elaborado',
            insumoId,
            cantidad,
        })),
    });
    return count;
}

async function cargarHamburguesasYBebidas() {
    const destino = confirmarCargaDemo();

    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);

        const creados = { categorias: 0, productos: 0, insumos: 0, filasReceta: 0 };
        const idPorCodigo = new Map();
        for (const [codigo, { nombre, unidadBase }] of Object.entries(insumos)) {
            const insumo = await cargarRegistro(tx.insumo, { codigo, nombre, unidadBase, activo: true },
                { OR: [{ codigo }, { nombre }] }, creados, 'insumos');
            idPorCodigo.set(codigo, insumo.id);
        }

        const verificados = [];
        for (const grupo of categorias) {
            const categoria = await cargarRegistro(tx.categoria, { nombre: grupo.nombre, activo: true },
                { nombre: grupo.nombre }, creados, 'categorias');
            const ids = [];

            for (const { codigo, nombre, precio, receta } of grupo.productos) {
                const producto = await cargarRegistro(tx.producto, {
                    codigo,
                    nombre,
                    tipo: 'elaborado',
                    categoriaId: categoria.id,
                    precioVenta: new Prisma.Decimal(precio),
                    insumoReventaId: null,
                    activo: true,
                }, { OR: [{ codigo }, { nombre }] }, creados, 'productos');
                ids.push(producto.id);
                creados.filasReceta += await cargarReceta(tx, producto, receta, idPorCodigo);
            }

            const productos = await tx.producto.count({
                where: { id: { in: ids }, categoriaId: categoria.id, tipo: 'elaborado' },
            });
            const filasReceta = await tx.receta.count({ where: { productoId: { in: ids } } });
            if (productos !== grupo.productos.length || filasReceta !== grupo.filasEsperadas) {
                throw new ConflictoCarga(`Los conteos para ${grupo.nombre} no coinciden con los esperados.`);
            }
            verificados.push({ categoria: categoria.nombre, productos, filasReceta });
        }

        return { destino: destino.destino, creados, verificados };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarHamburguesasYBebidas(), null, 2));
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
