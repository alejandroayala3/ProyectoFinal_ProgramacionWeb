import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';
import { registrarVenta } from '../src/services/venta.service.js';
import { emitirDocumentoVenta } from '../src/services/facturacion.service.js';
import { abrirTurno, cerrarTurno, registrarCobro } from '../src/services/caja.service.js';

const referenciaVenta = 'DEMO-VENTA-CCF-001';
const precio = new Prisma.Decimal('1.50');
const datosCliente = {
    nombre: 'Taller Ficticio Orígenes Demo', razonSocial: 'Taller Ficticio Orígenes Demo, S.A. de C.V.',
    nit: '0000-000000-000-0', nrc: '000000-0', activo: true,
};

async function clienteDemo(tx) {
    const clientes = await tx.cliente.findMany({
        where: { OR: [{ nit: datosCliente.nit }, { nrc: datosCliente.nrc }, { nombre: datosCliente.nombre }] },
    });
    if (!clientes.length) return tx.cliente.create({ data: datosCliente });
    const [cliente] = clientes;
    if (clientes.length !== 1 || !Object.entries(datosCliente).every(([campo, valor]) => cliente[campo] === valor)) {
        throw new ErrorCargaDemo('Los datos del cliente de prueba CCF ya están en uso.');
    }
    return cliente;
}

async function cargarCcfDemo() {
    const destino = confirmarCargaDemo();
    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);
        const sucursal = await tx.sucursal.findUnique({ where: { nombre: 'Sucursal Central' } });
        const usuario = await tx.usuario.findUnique({ where: { correo: 'admin@origenes.sv' } });
        const agua = await tx.producto.findUnique({ where: { codigo: 'REV-AGUA-500-ML' }, include: { insumoReventa: true } });
        if (!sucursal?.activo || !usuario?.activo || usuario.sucursalId !== sucursal.id ||
            !agua?.activo || agua.tipo !== 'reventa' || !agua.insumoReventa?.activo || agua.insumoReventa.unidadBase !== 'unidad') {
            throw new ErrorCargaDemo('Faltan Central, su cuenta demo o el agua embotellada activa de reventa.');
        }
        const cliente = await clienteDemo(tx);
        const existencia = { sucursalId_insumoId: { sucursalId: sucursal.id, insumoId: agua.insumoReventa.id } };
        const antes = await tx.existenciaSucursal.findUniqueOrThrow({ where: existencia });
        const previa = await tx.venta.findUnique({
            where: { referencia: referenciaVenta }, include: { detalles: { include: { movimientos: true } } },
        });
        if (!previa && !agua.precioVenta.equals(precio)) throw new ErrorCargaDemo('El agua no tiene el precio demo de $1.50.');
        if (previa) {
            const [detalle] = previa.detalles;
            const movimiento = detalle?.movimientos[0];
            if (previa.sucursalId !== sucursal.id || previa.usuarioId !== usuario.id || previa.detalles.length !== 1 ||
                detalle.productoId !== agua.id || detalle.cantidad !== 1 || !detalle.precioUnitario.equals(precio) ||
                detalle.movimientos.length !== 1 || movimiento.insumoId !== agua.insumoReventa.id ||
                movimiento.sucursalId !== sucursal.id || movimiento.tipo !== 'salida' || !movimiento.cantidadCambio.equals(-1)) {
                throw new ErrorCargaDemo('La venta CCF existente difiere de la venta demo o de su salida de inventario.');
            }
        }
        const venta = previa ?? await registrarVenta(tx, {
            referencia: referenciaVenta, sucursalId: sucursal.id, usuarioId: usuario.id,
            lineas: [{ productoId: agua.id, cantidad: 1 }],
        });
        const { creado, documento } = await emitirDocumentoVenta(tx, {
            ventaId: venta.id, tipoDocumento: 'ccf', clienteId: cliente.id,
        });
        if (!venta.total.equals(precio) || !venta.subtotal.equals('1.33') || !venta.iva.equals('0.17') ||
            !documento.total.equals(venta.total) || !documento.subtotal.equals(venta.subtotal) ||
            !documento.iva.equals(venta.iva) || documento.nit !== cliente.nit || documento.nrc !== cliente.nrc ||
            documento.razonSocial !== cliente.razonSocial) {
            throw new ErrorCargaDemo('Los importes o los datos históricos del CCF no coinciden con la venta demo.');
        }

        const turno = await abrirTurno(tx, {
            referencia: 'DEMO-TURNO-CCF-001', sucursalId: sucursal.id, usuarioId: usuario.id, fondoInicial: '20.00',
        });
        const cobro = await registrarCobro(tx, {
            referencia: 'DEMO-COBRO-CCF-001', referenciaExterna: 'CHIVO-DEMO-001', metodo: 'bitcoin',
            turnoId: turno.id, ventaId: venta.id, monto: precio,
        });
        const cerrado = await cerrarTurno(tx, { turnoId: turno.id, efectivoContado: '20.00' });
        const cobros = await tx.cobroVenta.count({ where: { turnoId: turno.id } });
        const despues = await tx.existenciaSucursal.findUniqueOrThrow({ where: existencia });
        if (cobros !== 1 || !cerrado.totalBitcoin?.equals(precio) || !cerrado.totalDigital?.isZero() ||
            !cerrado.totalTarjeta?.isZero() || !cerrado.efectivoEsperado.equals('20.00') || !cerrado.diferencia.isZero() ||
            !antes.cantidadActual.minus(despues.cantidadActual).equals(previa ? 0 : 1)) {
            throw new ErrorCargaDemo('No coincide el cuadre del cobro bitcoin o la salida de agua.');
        }

        return {
            venta: referenciaVenta, ventaCreada: !previa, documentoCreado: creado, correlativo: documento.correlativo,
            totalUSD: venta.total.toFixed(2), cobro: cobro.metodo, efectivoEsperado: cerrado.efectivoEsperado.toFixed(2),
            aguaDescontada: antes.cantidadActual.minus(despues.cantidadActual).toNumber(),
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarCcfDemo()));
} catch (error) {
    console.error(error instanceof ErrorCargaDemo ? error.message : `No se completó el CCF demo (${error.code ?? error.name}).`);
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
