import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const roles = [
    { codigo: 'admin', nombre: 'Administrador' },
    { codigo: 'gerente', nombre: 'Gerente' },
    { codigo: 'cajero', nombre: 'Cajero' },
    { codigo: 'barista', nombre: 'Barista' }
];

async function sembrar() {
    const destino = confirmarCargaDemo();
    await prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);
        let rolAdmin;
        for (const rol of roles) {
            const registro = await tx.rol.upsert({ where: { codigo: rol.codigo }, update: {}, create: rol });
            if (rol.codigo === 'admin') rolAdmin = registro;
        }
        const sucursal = await tx.sucursal.upsert({
            where: { nombre: 'Sucursal Central' },
            update: {},
            create: { nombre: 'Sucursal Central' },
        });
        const correo = 'admin@origenes.sv';
        const usuario = await tx.usuario.findUnique({ where: { correo } });
        if (usuario) return;

        const password = process.env.DEMO_ADMIN_PASSWORD;
        if (!password?.trim()) {
            throw new ErrorCargaDemo('Configura DEMO_ADMIN_PASSWORD antes de crear la cuenta de demostración.');
        }
        const passwordHash = await bcrypt.hash(password, 10);
        await tx.usuario.create({
            data: {
                nombreCompleto: 'Administrador General',
                correo,
                passwordHash,
                rolId: rolAdmin.id,
                sucursalId: sucursal.id,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    await sembrar();
    console.log('Datos iniciales de demostración disponibles.');
} catch (error) {
    console.error(error instanceof ErrorCargaDemo ? error.message : `No se completó el seed (${error.code ?? error.name}).`);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
