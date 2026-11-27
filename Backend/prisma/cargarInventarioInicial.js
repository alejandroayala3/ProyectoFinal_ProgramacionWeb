import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const nombresSucursales = ['Sucursal Central', 'Escalón', 'Santa Elena'];
const motivoInicial = 'Carga inicial de inventario';
const cantidadesPorUnidad = {
    g: { cantidadActual: new Prisma.Decimal('5000'), cantidadMinima: new Prisma.Decimal('500') },
    ml: { cantidadActual: new Prisma.Decimal('10000'), cantidadMinima: new Prisma.Decimal('1000') },
    unidad: { cantidadActual: new Prisma.Decimal('100'), cantidadMinima: new Prisma.Decimal('10') },
};

class ConflictoCarga extends Error {}

async function cargarInventarioInicial() {
    const destino = confirmarCargaDemo();

    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);

        const sucursales = await tx.sucursal.findMany({
            where: { nombre: { in: nombresSucursales }, activo: true },
            select: { id: true, nombre: true },
        });
        const nombresActivos = new Set(sucursales.map(({ nombre }) => nombre));
        const faltantes = nombresSucursales.filter(nombre => !nombresActivos.has(nombre));
        if (faltantes.length > 0) {
            throw new ConflictoCarga(`Sucursales ausentes o inactivas: ${faltantes.join(', ')}.`);
        }

        const insumos = await tx.insumo.findMany({
            where: { activo: true },
            select: { id: true, codigo: true, unidadBase: true },
        });
        const existencias = await tx.existenciaSucursal.findMany({
            where: {
                sucursalId: { in: sucursales.map(({ id }) => id) },
                insumo: { activo: true },
            },
            select: {
                sucursalId: true,
                insumoId: true,
                movimientos: {
                    where: { motivo: motivoInicial, tipo: 'entrada', costoUnitarioCompra: null },
                    select: { motivo: true },
                },
            },
        });
        const porCombinacion = new Map(existencias.map(fila => [`${fila.sucursalId}:${fila.insumoId}`, fila]));
        const nuevas = [];
        let omitidas = 0;

        // La clave foránea de movimientos exige que toda entrada previa tenga una existencia.
        for (const sucursal of sucursales) {
            for (const insumo of insumos) {
                const actual = porCombinacion.get(`${sucursal.id}:${insumo.id}`);
                if (actual) {
                    const iniciales = actual.movimientos.filter(({ motivo }) => motivo === motivoInicial);
                    if (iniciales.length !== 1) {
                        throw new ConflictoCarga(
                            `Conflicto en ${sucursal.nombre} / ${insumo.codigo}: hay existencias previas sin una única carga inicial identificable.`,
                        );
                    }
                    omitidas++;
                    continue;
                }

                const cantidades = cantidadesPorUnidad[insumo.unidadBase];
                if (!cantidades) {
                    throw new ConflictoCarga(`Unidad no reconocida para el insumo ${insumo.codigo}.`);
                }
                nuevas.push({ sucursalId: sucursal.id, insumoId: insumo.id, ...cantidades });
            }
        }

        let existenciasCreadas = 0;
        let movimientosCreados = 0;
        if (nuevas.length > 0) {
            const saldos = await tx.existenciaSucursal.createMany({ data: nuevas });
            const movimientos = await tx.movimientoInventario.createMany({
                data: nuevas.map(({ sucursalId, insumoId, cantidadActual }) => ({
                    sucursalId,
                    insumoId,
                    tipo: 'entrada',
                    cantidadCambio: cantidadActual,
                    motivo: motivoInicial,
                    costoUnitarioCompra: null,
                })),
            });
            existenciasCreadas = saldos.count;
            movimientosCreados = movimientos.count;
            if (existenciasCreadas !== nuevas.length || movimientosCreados !== nuevas.length) {
                throw new ConflictoCarga('Los conteos de existencias y movimientos nuevos no coinciden.');
            }
        }

        return {
            sucursales: sucursales.length,
            insumosActivos: insumos.length,
            combinaciones: sucursales.length * insumos.length,
            existenciasCreadas,
            movimientosCreados,
            omitidas,
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarInventarioInicial(), null, 2));
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
