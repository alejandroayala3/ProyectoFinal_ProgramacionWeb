import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma.js';
import { ErrorCargaDemo, confirmarCargaDemo, verificarDestinoDemo } from './destinoDemo.js';

const proveedorDemo = { codigo: 'PROV-DEMO-001', nombre: 'Proveedor ficticio Orígenes', activo: true };
const factura = 'DEMO-COMPRA-001';
const motivo = 'Entrada por compra de prueba';
const cantidad = new Prisma.Decimal('1000');
const costoUnitario = new Prisma.Decimal('0.005');
const subtotal = cantidad.mul(costoUnitario).toDecimalPlaces(2);
const iva = subtotal.mul('0.13').toDecimalPlaces(2);
const total = subtotal.plus(iva);
const pagoDemo = {
    referencia: 'DEMO-TRANSFERENCIA-001',
    metodo: 'transferencia',
    monto: new Prisma.Decimal('2.00'),
};

class ConflictoCompra extends Error {}

function verificarCompra(compra, sucursalId, insumoId) {
    if (!compra || compra.sucursalId !== sucursalId ||
        !compra.subtotal.equals(subtotal) || !compra.iva.equals(iva) || !compra.total.equals(total)) {
        throw new ConflictoCompra('La sucursal o los importes de la compra difieren de la carga de prueba.');
    }

    const [detalle] = compra.detalles;
    if (compra.detalles.length !== 1 || detalle.insumoId !== insumoId ||
        !detalle.cantidad.equals(cantidad) || !detalle.costoUnitario.equals(costoUnitario)) {
        throw new ConflictoCompra('El detalle de la compra difiere de la carga de prueba.');
    }

    const [pago] = compra.pagos;
    if (compra.pagos.length !== 1 || pago.referencia !== pagoDemo.referencia ||
        pago.metodo !== pagoDemo.metodo || !pago.monto.equals(pagoDemo.monto)) {
        throw new ConflictoCompra('Los pagos de la compra difieren de la carga de prueba.');
    }

    const [movimiento] = detalle.movimientos;
    if (detalle.movimientos.length !== 1 || movimiento.sucursalId !== sucursalId ||
        movimiento.insumoId !== insumoId || movimiento.tipo !== 'entrada' ||
        movimiento.motivo !== motivo || !movimiento.cantidadCambio.equals(cantidad) ||
        !movimiento.costoUnitarioCompra?.equals(costoUnitario)) {
        throw new ConflictoCompra('La compra no tiene la entrada de inventario esperada.');
    }

    const pagado = compra.pagos.reduce((suma, fila) => suma.plus(fila.monto), new Prisma.Decimal(0));
    return {
        compraId: compra.id,
        pagoId: pago.id,
        movimientoId: movimiento.id.toString(),
        subtotal: compra.subtotal.toFixed(2),
        iva: compra.iva.toFixed(2),
        total: compra.total.toFixed(2),
        pagado: pagado.toFixed(2),
        saldo: compra.total.minus(pagado).toFixed(2),
    };
}

async function cargarCompraPrueba() {
    const destino = confirmarCargaDemo();

    return prisma.$transaction(async (tx) => {
        await verificarDestinoDemo(tx, destino);

        const sucursal = await tx.sucursal.findUnique({ where: { nombre: 'Sucursal Central' } });
        const insumo = await tx.insumo.findUnique({ where: { codigo: 'INS-PECHUGA-POLLO' } });
        if (!sucursal?.activo || !insumo?.activo || insumo.unidadBase !== 'g') {
            throw new ConflictoCompra('La sucursal o la pechuga de pollo activa en gramos no está disponible.');
        }

        const claveExistencia = { sucursalId: sucursal.id, insumoId: insumo.id };
        const dondeExistencia = { sucursalId_insumoId: claveExistencia };
        const stockAntes = await tx.existenciaSucursal.findUnique({ where: dondeExistencia });
        if (!stockAntes) throw new ConflictoCompra('Falta la existencia de pechuga de pollo en Sucursal Central.');

        const candidatos = await tx.proveedor.findMany({
            where: { OR: [{ codigo: proveedorDemo.codigo }, { nombre: proveedorDemo.nombre }] },
            take: 2,
        });
        let [proveedor] = candidatos;
        if (candidatos.length > 1 || (proveedor && (
            proveedor.codigo !== proveedorDemo.codigo || proveedor.nombre !== proveedorDemo.nombre || !proveedor.activo
        ))) {
            throw new ConflictoCompra('Hay un proveedor existente que no coincide con el proveedor de prueba.');
        }
        if (!proveedor) proveedor = await tx.proveedor.create({ data: proveedorDemo });

        const dondeCompra = { proveedorId_numeroFactura: { proveedorId: proveedor.id, numeroFactura: factura } };
        const incluirCompra = { detalles: { include: { movimientos: true } }, pagos: true };
        let compra = await tx.compra.findUnique({ where: dondeCompra, include: incluirCompra });
        const creada = compra === null;
        let stockDespues = stockAntes.cantidadActual;

        if (creada) {
            const nueva = await tx.compra.create({
                data: {
                    proveedorId: proveedor.id,
                    sucursalId: sucursal.id,
                    numeroFactura: factura,
                    subtotal,
                    iva,
                    total,
                    detalles: { create: { insumoId: insumo.id, cantidad, costoUnitario } },
                    pagos: { create: pagoDemo },
                },
                select: { detalles: { select: { id: true } } },
            });
            await tx.movimientoInventario.create({
                data: {
                    ...claveExistencia,
                    detalleCompraId: nueva.detalles[0].id,
                    tipo: 'entrada',
                    cantidadCambio: cantidad,
                    motivo,
                    costoUnitarioCompra: costoUnitario,
                },
            });
            const stock = await tx.existenciaSucursal.update({
                where: dondeExistencia,
                data: { cantidadActual: { increment: cantidad } },
                select: { cantidadActual: true },
            });
            stockDespues = stock.cantidadActual;
            compra = await tx.compra.findUnique({ where: dondeCompra, include: incluirCompra });
        }

        const aumento = stockDespues.minus(stockAntes.cantidadActual);
        if (!aumento.equals(creada ? cantidad : 0)) {
            throw new ConflictoCompra('El aumento de existencias no coincide con la entrada.');
        }
        return {
            creada,
            ...verificarCompra(compra, sucursal.id, insumo.id),
            stockAntes: stockAntes.cantidadActual.toString(),
            stockDespues: stockDespues.toString(),
            aumento: aumento.toString(),
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

try {
    console.log(JSON.stringify(await cargarCompraPrueba(), null, 2));
} catch (error) {
    if (error instanceof ErrorCargaDemo || error instanceof ConflictoCompra) {
        console.error(error.message);
    } else if (error.code === 'P2002' || error.code === 'P2034') {
        console.error(`La carga se revirtió por un conflicto de datos o concurrencia (${error.code}). Puedes volver a ejecutarla.`);
    } else {
        console.error(`No se completó la carga. Revisa Prisma y la conexión (${error.code ?? error.name}).`);
    }
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
