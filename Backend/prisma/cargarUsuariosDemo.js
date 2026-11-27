import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const sucursalesDemo = [
    { codigo: 'central', nombre: 'Sucursal Central' },
    { codigo: 'escalon', nombre: 'Escalón' },
    { codigo: 'santa_elena', nombre: 'Santa Elena' },
];
const codigosRol = ['gerente', 'cajero', 'barista'];

async function cargarUsuariosDemo() {
    const destino = confirmarCargaDemo();
    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);
        const roles = await tx.rol.findMany({ where: { codigo: { in: codigosRol } } });
        const rolPorCodigo = new Map(roles.map((rol) => [rol.codigo, rol]));
        const sucursales = await tx.sucursal.findMany({
            where: { activo: true, nombre: { in: sucursalesDemo.map(({ nombre }) => nombre) } },
        });
        const sucursalPorNombre = new Map(sucursales.map((sucursal) => [sucursal.nombre, sucursal]));

        let creados = 0;
        let reutilizados = 0;
        for (const { codigo, nombre } of sucursalesDemo) {
            const sucursal = sucursalPorNombre.get(nombre);
            if (!sucursal) throw new ErrorCargaDemo(`Falta la sucursal activa ${nombre}.`);

            for (const codigoRol of codigosRol) {
                const rol = rolPorCodigo.get(codigoRol);
                if (!rol) throw new ErrorCargaDemo(`Falta el rol ${codigoRol}. Ejecuta el seed primero.`);

                const identificadorSucursal = codigo.replaceAll('_', '.');
                const correo = `${codigoRol}.${identificadorSucursal}@origenes.sv`;
                const existente = await tx.usuario.findUnique({
                    where: { correo }, select: { rolId: true, sucursalId: true, activo: true },
                });
                if (existente) {
                    if (existente.rolId !== rol.id || existente.sucursalId !== sucursal.id || !existente.activo) {
                        throw new ErrorCargaDemo(`La cuenta ${correo} existe con otro rol, otra sucursal o está inactiva. Se revirtió la carga de usuarios.`);
                    }
                    reutilizados++;
                    continue;
                }

                const variable = `DEMO_${codigoRol.toUpperCase()}_${codigo.toUpperCase()}_PASSWORD`;
                const password = process.env[variable];
                if (!password?.trim() || bcrypt.truncates(password)) {
                    throw new ErrorCargaDemo(`Define ${variable} con una contraseña no vacía de hasta 72 bytes.`);
                }
                await tx.usuario.create({
                    data: {
                        correo,
                        nombreCompleto: `${rol.nombre} demo - ${nombre}`,
                        passwordHash: await bcrypt.hash(password, 10),
                        rolId: rol.id,
                        sucursalId: sucursal.id,
                    },
                });
                creados++;
            }
        }
        return { creados, reutilizados };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarUsuariosDemo()));
} catch (error) {
    console.error(error instanceof ErrorCargaDemo ? error.message : `No se completó la carga de usuarios demo (${error.code ?? error.name}).`);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
