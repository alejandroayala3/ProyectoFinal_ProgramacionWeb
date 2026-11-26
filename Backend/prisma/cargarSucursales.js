import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';

const nombres = ['Escalón', 'Santa Elena'];

class ConflictoCarga extends Error {}

async function cargarSucursales() {
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

        for (const nombre of nombres) {
            const sucursal = await tx.sucursal.findUnique({ where: { nombre }, select: { activo: true } });
            if (!sucursal) {
                await tx.sucursal.create({ data: { nombre, activo: true } });
            } else if (!sucursal.activo) {
                throw new ConflictoCarga(`Conflicto: la sucursal ${nombre} existe y está inactiva. Se revirtió la carga.`);
            }
        }

        return tx.sucursal.findMany({
            select: { id: true, nombre: true, activo: true },
            orderBy: { id: 'asc' },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    const sucursales = await cargarSucursales();
    console.log(JSON.stringify(sucursales, null, 2));
} catch (error) {
    if (error instanceof ConflictoCarga) {
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
