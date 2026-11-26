import bcrypt from 'bcryptjs';
import prisma from '../src/config/prisma.js';

const roles = [
    { codigo: 'admin', nombre: 'Administrador' },
    { codigo: 'gerente', nombre: 'Gerente' },
    { codigo: 'cajero', nombre: 'Cajero' },
    { codigo: 'barista', nombre: 'Barista' }
];

async function sembrar() {
    for (const rol of roles) {
        await prisma.rol.upsert({ where: { codigo: rol.codigo }, update: { nombre: rol.nombre }, create: rol });
    }
    const sucursal = await prisma.sucursal.upsert({
        where: { nombre: 'Sucursal Central' },
        update: {},
        create: { nombre: 'Sucursal Central' }
    });
    const rolAdmin = await prisma.rol.findUnique({ where: { codigo: 'admin' } });
    const passwordHash = await bcrypt.hash('Admin@2026', 10);
    await prisma.usuario.upsert({
        where: { correo: 'admin@origenes.sv' },
        update: {},
        create: {
            nombreCompleto: 'Administrador General',
            correo: 'admin@origenes.sv',
            passwordHash,
            rolId: rolAdmin.id,
            sucursalId: sucursal.id
        }
    });
}

sembrar()
    .then(() => console.log('Datos iniciales cargados'))
    .catch((error) => { console.error('Error al sembrar datos:', error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());