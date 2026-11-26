const tiposDocumento = new Set(['consumidor_final', 'ccf']);

export class ErrorFacturacion extends Error {
    constructor(codigo, mensaje) {
        super(mensaje);
        this.codigo = codigo;
    }
}

// El bloqueo de serie se mantiene hasta que termina la transacción del llamador.
export async function emitirDocumentoVenta(tx, { ventaId, tipoDocumento, clienteId = null }) {
    if (!tiposDocumento.has(tipoDocumento)) {
        throw new ErrorFacturacion('TIPO_INVALIDO', 'Indica consumidor final o CCF.');
    }
    if (!Number.isInteger(ventaId) || ventaId < 1 ||
        (clienteId !== null && (!Number.isInteger(clienteId) || clienteId < 1))) {
        throw new ErrorFacturacion('DATOS_INVALIDOS', 'El identificador de venta o cliente no es válido.');
    }
    if (tipoDocumento === 'ccf' && clienteId === null) {
        throw new ErrorFacturacion('DATOS_CCF', 'El CCF requiere un cliente con razón social, NIT y NRC.');
    }

    // Serializa los reintentos para la misma venta sin alterar la venta ni su cobro.
    const [venta] = await tx.$queryRaw`
        SELECT id, sucursal_id AS sucursalId, subtotal, iva, total
        FROM dbo.ventas WITH (UPDLOCK, HOLDLOCK)
        WHERE id = ${ventaId}
    `;
    if (!venta) throw new ErrorFacturacion('VENTA_INEXISTENTE', 'La venta no existe.');

    const previo = await tx.documentoVenta.findUnique({ where: { ventaId } });
    if (previo) {
        if (previo.tipoDocumento !== tipoDocumento || previo.clienteId !== clienteId) {
            throw new ErrorFacturacion('VENTA_FACTURADA', 'La venta ya tiene un documento de otro tipo o cliente.');
        }
        return { creado: false, documento: previo };
    }

    let datosCliente = {};
    if (clienteId !== null) {
        const cliente = await tx.cliente.findUnique({
            where: { id: clienteId },
            select: { nombre: true, razonSocial: true, nit: true, nrc: true, activo: true },
        });
        if (!cliente?.activo || !cliente.nombre.trim()) {
            throw new ErrorFacturacion('CLIENTE_INVALIDO', 'El cliente debe estar activo y tener nombre.');
        }
        datosCliente = {
            nombreCliente: cliente.nombre.trim(),
            razonSocial: cliente.razonSocial?.trim() || null,
            nit: cliente.nit?.trim() || null,
            nrc: cliente.nrc?.trim() || null,
        };
        if (tipoDocumento === 'ccf' && (!datosCliente.razonSocial || !datosCliente.nit || !datosCliente.nrc)) {
            throw new ErrorFacturacion('DATOS_CCF', 'El CCF requiere razón social, NIT y NRC.');
        }
    }

    const serie = { sucursalId: venta.sucursalId, tipoDocumento };
    const recurso = `origenes:documentos:${serie.sucursalId}:${serie.tipoDocumento}`;
    const [bloqueo] = await tx.$queryRaw`
        DECLARE @resultado int;
        EXEC @resultado = sys.sp_getapplock
            @Resource = ${recurso}, @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 10000;
        SELECT @resultado AS resultado;
    `;
    if (bloqueo?.resultado !== 0 && bloqueo?.resultado !== 1) {
        throw new ErrorFacturacion('SERIE_OCUPADA', 'No se pudo reservar el correlativo de esta serie.');
    }

    const { _max } = await tx.documentoVenta.aggregate({ where: serie, _max: { correlativo: true } });
    const correlativo = (_max.correlativo ?? 0) + 1;
    if (correlativo > 2147483647) {
        throw new ErrorFacturacion('SERIE_AGOTADA', 'La serie alcanzó su correlativo máximo.');
    }

    const documento = await tx.documentoVenta.create({
        data: {
            ventaId,
            clienteId,
            ...serie,
            ...datosCliente,
            correlativo,
            subtotal: venta.subtotal,
            iva: venta.iva,
            total: venta.total,
        },
    });
    return { creado: true, documento };
}
