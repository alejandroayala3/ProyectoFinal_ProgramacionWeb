import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';
import { emitirDocumentoVenta, ErrorFacturacion } from '../src/services/facturacion.service.js';

async function cargarFacturaPrueba() {
    const destino = confirmarCargaDemo();

    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);

        const venta = await tx.venta.findUnique({
            where: { referencia: 'DEMO-VENTA-001' },
            select: { id: true, referencia: true, subtotal: true, iva: true, total: true },
        });
        if (!venta?.total.equals('8.50')) {
            throw new ErrorFacturacion('VENTA_INVALIDA', 'No se encontró la venta de prueba de $8.50.');
        }

        const { creado, documento } = await emitirDocumentoVenta(tx, {
            ventaId: venta.id,
            tipoDocumento: 'consumidor_final',
        });
        if (!documento.subtotal.equals(venta.subtotal) || !documento.iva.equals(venta.iva) ||
            !documento.total.equals(venta.total)) {
            throw new ErrorFacturacion('IMPORTES_INVALIDOS', 'El documento de prueba no coincide con los importes de la venta.');
        }

        return {
            creado,
            venta: venta.referencia,
            documentoId: documento.id,
            sucursalId: documento.sucursalId,
            tipo: documento.tipoDocumento,
            correlativo: documento.correlativo,
            subtotal: documento.subtotal.toFixed(2),
            iva: documento.iva.toFixed(2),
            total: documento.total.toFixed(2),
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarFacturaPrueba(), null, 2));
} catch (error) {
    if (error instanceof ErrorCargaDemo || error instanceof ErrorFacturacion) {
        console.error(error.message);
    } else if (error.code === 'P2002' || error.code === 'P2034') {
        console.error(`La emisión se revirtió por un conflicto de datos o concurrencia (${error.code}). Puedes volver a ejecutarla.`);
    } else {
        console.error(`No se completó la emisión. Revisa Prisma y la conexión (${error.code ?? error.name}).`);
    }
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
