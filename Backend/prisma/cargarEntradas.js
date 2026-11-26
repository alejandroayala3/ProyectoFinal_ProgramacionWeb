import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';

const nombreCategoria = 'Entradas';
const nombresInsumos = {
    'INS-PAN': 'Pan',
    'INS-MANTEQUILLA': 'Mantequilla',
    'INS-AJO': 'Ajo',
    'INS-SAL': 'Sal',
    'INS-MOZZARELLA': 'Queso mozzarella',
    'INS-CHAMPINONES': 'Champiñones',
    'INS-LECHUGA': 'Lechuga',
    'INS-TOMATE': 'Tomate',
    'INS-PEPINO': 'Pepino',
};

const entradas = [
    {
        codigo: 'ENT-PAN-AJO',
        nombre: 'Pan al ajo',
        precio: '3.00',
        receta: {
            'INS-PAN': 60,
            'INS-MANTEQUILLA': 10,
            'INS-AJO': 3,
            'INS-SAL': 1,
        },
    },
    {
        codigo: 'ENT-PAN-AJO-GRATINADO',
        nombre: 'Pan al ajo gratinado',
        precio: '4.00',
        receta: {
            'INS-PAN': 60,
            'INS-MANTEQUILLA': 10,
            'INS-AJO': 3,
            'INS-SAL': 1,
            'INS-MOZZARELLA': 30,
        },
    },
    {
        codigo: 'ENT-CHAMPINONES-AJILLO',
        nombre: 'Champiñones al ajillo',
        precio: '6.00',
        receta: {
            'INS-CHAMPINONES': 150,
            'INS-MANTEQUILLA': 15,
            'INS-AJO': 5,
            'INS-SAL': 1,
        },
    },
    {
        codigo: 'ENT-ENSALADA-ORIGENES',
        nombre: 'Ensalada fresca Orígenes',
        precio: '4.50',
        receta: {
            'INS-LECHUGA': 80,
            'INS-TOMATE': 60,
            'INS-PEPINO': 50,
            'INS-SAL': 1,
        },
    },
];

class ConflictoCarga extends Error {}

function comprobarCampo(etiqueta, campo, coincide) {
    if (!coincide) {
        throw new ConflictoCarga(`Conflicto en ${etiqueta}: el campo ${campo} difiere de la carga inicial.`);
    }
}

async function cargarRegistro(tabla, datos, entidad, creados, contador) {
    const { codigo, nombre } = datos;
    const etiqueta = `${entidad} ${codigo} (${nombre})`;
    const candidatos = await tabla.findMany({ where: { OR: [{ codigo }, { nombre }] }, take: 2 });

    if (candidatos.length === 0) {
        const creado = await tabla.create({ data: datos });
        creados[contador]++;
        return creado;
    }
    if (candidatos.length > 1) {
        throw new ConflictoCarga(`Conflicto en ${etiqueta}: hay más de un registro con ese código o nombre.`);
    }

    const [actual] = candidatos;
    for (const [campo, esperado] of Object.entries(datos)) {
        const coincide = Prisma.Decimal.isDecimal(esperado) ? esperado.equals(actual[campo]) : actual[campo] === esperado;
        comprobarCampo(etiqueta, campo, coincide);
    }
    return actual;
}

async function verificarCarga(tx, categoriaId, productoIds) {
    const categorias = await tx.categoria.count({ where: { id: categoriaId, nombre: nombreCategoria } });
    const productos = await tx.producto.count({ where: { id: { in: productoIds }, categoriaId } });
    const recetas = await tx.receta.findMany({
        where: { productoId: { in: productoIds } },
        select: { insumoId: true },
    });
    const insumoIds = [...new Set(recetas.map(({ insumoId }) => insumoId))];
    const insumosUtilizados = await tx.insumo.count({ where: { id: { in: insumoIds } } });
    const filasReceta = recetas.length;

    if (categorias !== 1 || productos !== 4 || insumosUtilizados !== 9 || filasReceta !== 17) {
        throw new ConflictoCarga('Los conteos de la carga no coinciden con los valores esperados.');
    }
    return { categorias, productos, insumosUtilizados, filasReceta };
}

async function cargarEntradas() {
    if (process.env.DB_HOST?.toLowerCase() !== 'localhost' ||
        Number(process.env.DB_PORT) !== 1432 ||
        process.env.DB_NAME !== 'origenesv_nuevo') {
        throw new ConflictoCarga('La carga solo se puede ejecutar en localhost:1432/origenesv_nuevo.');
    }

    return prisma.$transaction(async (tx) => {
        const [destino] = await tx.$queryRaw`
            SELECT DB_NAME() AS base, CONVERT(int, CONNECTIONPROPERTY('local_tcp_port')) AS puerto
        `;
        if (destino?.base !== 'origenesv_nuevo' || destino.puerto !== 1432) {
            throw new ConflictoCarga('La conexión SQL no corresponde a la base y puerto esperados.');
        }

        const creados = { categorias: 0, productos: 0, insumos: 0, filasReceta: 0 };
        let categoria = await tx.categoria.findUnique({ where: { nombre: nombreCategoria } });
        if (categoria) {
            comprobarCampo('categoría Entradas', 'nombre', categoria.nombre === nombreCategoria);
            comprobarCampo('categoría Entradas', 'activo', categoria.activo);
        } else {
            categoria = await tx.categoria.create({ data: { nombre: nombreCategoria, activo: true } });
            creados.categorias = 1;
        }

        const idPorCodigoInsumo = new Map();
        for (const [codigo, nombre] of Object.entries(nombresInsumos)) {
            const insumo = await cargarRegistro(
                tx.insumo, { codigo, nombre, unidadBase: 'g', activo: true }, 'insumo', creados, 'insumos',
            );
            idPorCodigoInsumo.set(codigo, insumo.id);
        }

        const productoIds = [];
        for (const { codigo, nombre, precio, receta } of entradas) {
            const producto = await cargarRegistro(tx.producto, {
                codigo,
                nombre,
                categoriaId: categoria.id,
                tipo: 'elaborado',
                precioVenta: new Prisma.Decimal(precio),
                insumoReventaId: null,
                activo: true,
            }, 'producto', creados, 'productos');
            productoIds.push(producto.id);

            const requeridos = new Map(
                Object.entries(receta).map(([codigoInsumo, gramos]) => [idPorCodigoInsumo.get(codigoInsumo), gramos]),
            );
            const actuales = await tx.receta.findMany({
                where: { productoId: producto.id },
                select: { insumoId: true, cantidad: true, insumo: { select: { codigo: true } } },
            });
            for (const fila of actuales) {
                const gramos = requeridos.get(fila.insumoId);
                const etiqueta = `receta de ${nombre}, insumo ${fila.insumo.codigo}`;
                comprobarCampo(etiqueta, 'ingrediente', gramos !== undefined);
                comprobarCampo(etiqueta, 'cantidad', fila.cantidad.equals(gramos));
                requeridos.delete(fila.insumoId);
            }

            const faltantes = Array.from(requeridos, ([insumoId, cantidad]) => ({
                productoId: producto.id,
                tipoProducto: 'elaborado',
                insumoId,
                cantidad,
            }));
            if (faltantes.length > 0) {
                const resultado = await tx.receta.createMany({ data: faltantes });
                creados.filasReceta += resultado.count;
            }
        }

        const verificados = await verificarCarga(tx, categoria.id, productoIds);
        return { destino: 'localhost:1432/origenesv_nuevo', creados, verificados };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarEntradas(), null, 2));
} catch (error) {
    if (error instanceof ConflictoCarga) {
        console.error(error.message);
    } else if (error.code === 'P2002' || error.code === 'P2034') {
        console.error(`La carga se revirtió por un conflicto de datos o concurrencia (${error.code}). Vuelve a ejecutarla.`);
    } else {
        console.error(`No se completó la carga. Revisa Prisma y la conexión (${error.code ?? error.name}).`);
    }
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
