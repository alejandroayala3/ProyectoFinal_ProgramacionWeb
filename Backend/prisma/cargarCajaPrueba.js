import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';
import { abrirTurno, cerrarTurno, ErrorCaja, registrarCobro } from '../src/services/caja.service.js';

async function cargarCajaPrueba() {
    const destino = confirmarCargaDemo();

    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);

        const venta = await tx.venta.findUnique({
            where: { referencia: 'DEMO-VENTA-001' },
            include: { sucursal: { select: { nombre: true } } },
        });
        if (!venta || !venta.total.equals('8.50') || venta.sucursal.nombre !== 'Sucursal Central') {
            throw new ErrorCaja('VENTA_INVALIDA', 'No se encontró la venta de prueba de $8.50 en Sucursal Central.');
        }

        const turno = await abrirTurno(tx, {
            referencia: 'DEMO-CAJA-001',
            sucursalId: venta.sucursalId,
            usuarioId: venta.usuarioId,
            fondoInicial: '20.00',
        });
        const cobro = await registrarCobro(tx, {
            referencia: 'DEMO-COBRO-001',
            turnoId: turno.id,
            ventaId: venta.id,
            metodo: 'efectivo',
            monto: '8.50',
        });
        const cierre = await cerrarTurno(tx, { turnoId: turno.id, efectivoContado: '28.50' });
        const cobros = await tx.cobroVenta.count({ where: { turnoId: turno.id } });
        const manuales = await tx.movimientoCaja.count({ where: { turnoId: turno.id } });
        if (cobros !== 1 || manuales !== 0 || !cierre.efectivoEsperado.equals('28.50') ||
            !cierre.diferencia.equals(0) || !cierre.totalTarjeta.equals(0) || !cierre.totalDigital.equals(0)) {
            throw new ErrorCaja('CUADRE_INVALIDO', 'El turno de prueba no coincide con el cuadre esperado.');
        }
        return {
            referencia: turno.referencia,
            turnoId: turno.id,
            cobroId: cobro.id.toString(),
            fondoInicial: turno.fondoInicial.toFixed(2),
            cobroEfectivo: cobro.monto.toFixed(2),
            efectivoEsperado: cierre.efectivoEsperado.toFixed(2),
            efectivoContado: cierre.efectivoContado.toFixed(2),
            diferencia: cierre.diferencia.toFixed(2),
            cobros,
            manuales,
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarCajaPrueba(), null, 2));
} catch (error) {
    if (error instanceof ErrorCargaDemo || error instanceof ErrorCaja) {
        console.error(error.message);
    } else if (error.code === 'P2002' || error.code === 'P2034') {
        console.error(`No se confirmó el turno por un conflicto de datos o concurrencia (${error.code}). Puedes volver a ejecutarlo.`);
    } else {
        console.error(`No se completó el turno de prueba. Revisa Prisma y la conexión (${error.code ?? error.name}).`);
    }
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
