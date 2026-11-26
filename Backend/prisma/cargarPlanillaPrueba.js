import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { registrarPlanillaQuincenal } from '../src/services/planilla.service.js';

async function cargarPlanillaPrueba() {
    if (process.env.DB_HOST?.toLowerCase() !== 'localhost' ||
        Number(process.env.DB_PORT) !== 1432 || process.env.DB_NAME !== 'origenesv_nuevo') {
        throw new Error('La prueba solo se puede ejecutar en localhost:1432/origenesv_nuevo.');
    }
    return prisma.$transaction(async (tx) => {
        const [destino] = await tx.$queryRaw`
            SELECT DB_NAME() AS base, CONVERT(int, CONNECTIONPROPERTY('local_tcp_port')) AS puerto
        `;
        assert.ok(destino?.base === 'origenesv_nuevo' && destino.puerto === 1432, 'Destino SQL incorrecto.');
        const sucursal = await tx.sucursal.findUnique({ where: { nombre: 'Sucursal Central' } });
        assert.ok(sucursal?.activo, 'No se encontró Sucursal Central activa.');

        const datosEmpleado = {
            codigo: 'EMP-DEMO-001',
            cargo: 'barista',
            nombreCompleto: 'Empleado de demostración',
            sucursalId: sucursal.id,
            usuarioId: null,
            salarioMensual: new Prisma.Decimal('1200.00'),
            fechaIngreso: new Date('2026-11-01T00:00:00.000Z'),
            fechaSalida: null,
            activo: true,
        };
        const existente = await tx.empleado.findUnique({ where: { codigo: datosEmpleado.codigo } });
        if (existente) {
            assert.ok(Object.entries(datosEmpleado).every(([campo, valor]) => {
                if (valor instanceof Date) return existente[campo]?.getTime() === valor.getTime();
                if (Prisma.Decimal.isDecimal(valor)) return existente[campo]?.equals(valor);
                return existente[campo] === valor;
            }), 'Conflicto en los datos del empleado de prueba.');
        }
        const empleado = existente ?? await tx.empleado.create({ data: datosEmpleado });
        const { detalle, creado } = await registrarPlanillaQuincenal(tx, {
            empleadoId: empleado.id, anio: 2026, mes: 11, quincena: 1,
        });
        const esperados = { salarioPeriodo: '600.00', isss: '15.00', afp: '43.50', renta: '48.78', neto: '492.72' };
        const importes = Object.fromEntries(Object.keys(esperados).map((campo) => [campo, detalle[campo].toFixed(2)]));
        assert.deepEqual(importes, esperados, 'Los importes históricos difieren de lo esperado.');

        const empleados = await tx.empleado.count({ where: { codigo: datosEmpleado.codigo } });
        const periodo = { periodoInicio: new Date('2026-11-01T00:00:00.000Z'), periodoFin: new Date('2026-11-15T00:00:00.000Z') };
        const planillas = await tx.planilla.count({ where: periodo });
        const detalles = await tx.detallePlanilla.count({ where: { empleadoId: empleado.id, planilla: periodo } });
        assert.deepEqual({ empleados, planillas, detalles }, { empleados: 1, planillas: 1, detalles: 1 });
        return {
            empleadoCreado: !existente, detalleCreado: creado, empleadoId: empleado.id,
            planillaId: detalle.planillaId, empleados, planillas, detalles, ...importes,
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarPlanillaPrueba()));
} catch (error) {
    console.error(error.code === 'ERR_ASSERTION' || error instanceof RangeError
        ? error.message
        : `Falló la carga de planilla (${error.code ?? error.name}).`);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
