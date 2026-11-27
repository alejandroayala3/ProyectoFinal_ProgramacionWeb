import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const ingreso = new Date('2026-01-01T00:00:00.000Z');
const sucursales = [
    { nombre: 'Sucursal Central', correo: 'central', personal: [
        ['barista', 'Lucía Rivera Demo', '1200.00'],
        ['cajero', 'Diego Rivas Demo', '650.00'],
        ['gerente', 'Mariana Pérez Demo', '1100.00'],
    ] },
    { nombre: 'Escalón', correo: 'escalon', personal: [
        ['barista', 'Daniela Torres Demo', '585.00'],
        ['cajero', 'Adrián Campos Demo', '675.00'],
        ['gerente', 'Valeria Molina Demo', '1150.00'],
    ] },
    { nombre: 'Santa Elena', correo: 'santa.elena', personal: [
        ['barista', 'Gabriel Reyes Demo', '610.00'],
        ['cajero', 'Camila Méndez Demo', '700.00'],
        ['gerente', 'Andrés Flores Demo', '1250.00'],
    ] },
];

async function cargarEmpleadosDemo() {
    const destino = confirmarCargaDemo();
    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);
        let nuevos = 0;
        let actualizados = 0;
        let numero = 0;

        for (const sede of sucursales) {
            const sucursal = await tx.sucursal.findUnique({ where: { nombre: sede.nombre } });
            if (!sucursal?.activo) throw new ErrorCargaDemo(`Falta la sucursal activa ${sede.nombre}.`);
            for (const [cargo, nombreCompleto, salario] of sede.personal) {
                const codigo = `EMP-DEMO-${String(++numero).padStart(3, '0')}`;
                const correo = `${cargo}.${sede.correo}@origenes.sv`;
                const usuario = await tx.usuario.findUnique({ where: { correo }, include: { rol: true } });
                if (!usuario?.activo || usuario.rol.codigo !== cargo || usuario.sucursalId !== sucursal.id) {
                    throw new ErrorCargaDemo(`Falta la cuenta demo activa ${correo} con el rol y la sucursal correspondientes.`);
                }
                const otro = await tx.empleado.findFirst({ where: { usuarioId: usuario.id, NOT: { codigo } } });
                if (otro) throw new ErrorCargaDemo(`El usuario ${correo} ya está vinculado a ${otro.codigo}.`);

                const datos = {
                    codigo, cargo, nombreCompleto, sucursalId: sucursal.id, usuarioId: usuario.id,
                    salarioMensual: new Prisma.Decimal(salario), fechaIngreso: ingreso, fechaSalida: null, activo: true,
                };
                const existente = await tx.empleado.findUnique({ where: { codigo } });
                if (!existente) {
                    await tx.empleado.create({ data: datos });
                    nuevos++;
                    continue;
                }
                const coincide = Object.entries(datos).every(([campo, valor]) => {
                    if (valor instanceof Date) return existente[campo]?.getTime() === valor.getTime();
                    if (Prisma.Decimal.isDecimal(valor)) return existente[campo]?.equals(valor);
                    return existente[campo] === valor;
                });
                if (coincide) continue;

                // Aprovecha la ficha original y conserva su ID y su detalle de planilla.
                if (codigo === 'EMP-DEMO-001' && existente.nombreCompleto === 'Empleado de demostración' &&
                    existente.sucursalId === sucursal.id && existente.cargo === 'barista' &&
                    existente.fechaIngreso.toISOString() === '2026-11-01T00:00:00.000Z' &&
                    existente.usuarioId === null && existente.fechaSalida === null &&
                    existente.activo && existente.salarioMensual.equals(datos.salarioMensual)) {
                    await tx.empleado.update({
                        where: { id: existente.id },
                        data: { nombreCompleto, usuarioId: usuario.id, fechaIngreso: ingreso },
                    });
                    actualizados++;
                    continue;
                }
                throw new ErrorCargaDemo(`Los datos de ${codigo} difieren de los esperados. Se revirtió la carga de empleados.`);
            }
        }
        return { nuevos, actualizados, reutilizados: numero - nuevos - actualizados };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarEmpleadosDemo()));
} catch (error) {
    console.error(error instanceof ErrorCargaDemo ? error.message : `No se completó la carga de empleados demo (${error.code ?? error.name}).`);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
