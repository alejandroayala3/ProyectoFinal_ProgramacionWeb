import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { emitirDocumentoVenta, ErrorFacturacion } from '../src/services/facturacion.service.js';

async function cargarFacturaPrueba() {
    if (process.env.DB_HOST?.toLowerCase() !== 'localhost' ||
        Number(process.env.DB_PORT) !== 1432 || process.env.DB_NAME !== 'origenesv_nuevo') {
        throw new ErrorFacturacion('DESTINO_INVALIDO', 'La prueba solo se puede ejecutar en localhost:1432/origenesv_nuevo.');
    }

    return prisma.$transaction(async (tx) => {
        const [destino] = await tx.$queryRaw`
            SELECT DB_NAME() AS base, CONVERT(int, CONNECTIONPROPERTY('local_tcp_port')) AS puerto
        `;
        if (destino?.base !== 'origenesv_nuevo' || destino.puerto !== 1432) {
            throw new ErrorFacturacion('DESTINO_INVALIDO', 'La conexión SQL no corresponde a la base y puerto esperados.');
        }

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
    if (error instanceof ErrorFacturacion) {
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
