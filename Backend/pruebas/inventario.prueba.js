// pruebas de ventas e inventario sin base de datos.
// el objeto tx es un doble en memoria que implementa solo las consultas que usan los servicios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calcularImportes, registrarVenta } from '../src/services/venta.service.js';
import { ajustarExistencia } from '../src/services/inventario.service.js';
import { ErrorHttp } from '../src/utils/ErrorHttp.js';

const decimal = (valor) => new Prisma.Decimal(valor);
const sucursal_id = 1;
const clave = (insumo_id) => `${sucursal_id}:${insumo_id}`;

// datos nuevos en cada prueba, asi una no afecta a otra
function crear_datos() {
    const insumos = {
        cafe: { id: 1, nombre: 'café de especialidad', unidadBase: 'g', activo: true },
        leche: { id: 2, nombre: 'leche entera', unidadBase: 'ml', activo: true },
        vaso: { id: 3, nombre: 'vaso 16oz', unidadBase: 'unidad', activo: true },
        tapadera: { id: 4, nombre: 'tapadera 16oz', unidadBase: 'unidad', activo: true },
        vineta: { id: 5, nombre: 'viñeta', unidadBase: 'unidad', activo: true },
        galleta: { id: 6, nombre: 'galleta de chocolate (reventa)', unidadBase: 'unidad', activo: true },
        retirado: { id: 7, nombre: 'insumo retirado', unidadBase: 'g', activo: false }
    };
    const ingrediente = (insumo, cantidad) => ({ insumo, cantidad: decimal(cantidad) });
    const receta_bebida = (ml_leche) => [
        ingrediente(insumos.cafe, 18),
        ingrediente(insumos.leche, ml_leche),
        ingrediente(insumos.vaso, 1),
        ingrediente(insumos.tapadera, 1),
        ingrediente(insumos.vineta, 1)
    ];
    const producto = (id, nombre, extra = {}) => ({
        id,
        nombre,
        tipo: 'elaborado',
        precioVenta: decimal('3.50'),
        activo: true,
        categoria: { activo: true },
        insumoReventa: null,
        recetas: [],
        ...extra
    });
    const productos = [
        producto(1, 'latte grande', { recetas: receta_bebida(250) }),
        producto(2, 'capuchino grande', { recetas: receta_bebida(150) }),
        producto(3, 'galleta de chocolate', { tipo: 'reventa', precioVenta: decimal('1.25'), insumoReventa: insumos.galleta }),
        producto(4, 'sándwich sin receta'),
        producto(5, 'producto descontinuado', { activo: false, recetas: receta_bebida(250) })
    ];
    const existencias = new Map([
        [clave(1), decimal(1000)],
        [clave(2), decimal(5000)],
        [clave(3), decimal(100)],
        [clave(4), decimal(100)],
        [clave(5), decimal(100)],
        [clave(6), decimal(10)],
        [clave(7), decimal(50)]
    ]);
    return { insumos, productos, existencias };
}

// tx falso: solo las consultas que usan registrarVenta y ajustarExistencia
function crear_tx({ insumos, productos, existencias }) {
    const registro = { ventas: [], detalles: [], movimientos: [], descuentos: [] };
    return {
        registro,
        producto: {
            findMany: async ({ where }) => productos.filter((p) =>
                where.id.in.includes(p.id) && p.activo === where.activo && p.categoria.activo === where.categoria.activo)
        },
        venta: {
            create: async ({ data }) => {
                const venta = { id: registro.ventas.length + 1, ...data };
                registro.ventas.push(venta);
                return venta;
            }
        },
        detalleVenta: {
            create: async ({ data }) => {
                const detalle = { id: registro.detalles.length + 1, ...data };
                registro.detalles.push(detalle);
                return { id: detalle.id };
            }
        },
        existenciaSucursal: {
            updateMany: async ({ where, data }) => {
                const actual = existencias.get(`${where.sucursalId}:${where.insumoId}`);
                if (!actual) return { count: 0 };
                if (where.cantidadActual?.gte && actual.lt(where.cantidadActual.gte)) return { count: 0 };
                const { increment, decrement } = data.cantidadActual;
                existencias.set(`${where.sucursalId}:${where.insumoId}`, increment ? actual.plus(increment) : actual.minus(decrement));
                registro.descuentos.push(where.insumoId);
                return { count: 1 };
            },
            findUnique: async ({ where }) => {
                const { sucursalId, insumoId } = where.sucursalId_insumoId;
                const actual = existencias.get(`${sucursalId}:${insumoId}`);
                return actual ? { sucursalId, insumoId, cantidadActual: actual } : null;
            }
        },
        movimientoInventario: {
            createMany: async ({ data }) => {
                registro.movimientos.push(...data);
                return { count: data.length };
            },
            create: async ({ data }) => {
                registro.movimientos.push(data);
                return data;
            }
        },
        insumo: {
            findUnique: async ({ where }) => Object.values(insumos).find((i) => i.id === where.id) ?? null
        }
    };
}

function preparar() {
    const datos = crear_datos();
    return { datos, tx: crear_tx(datos) };
}

const stock = (datos, insumo_id) => datos.existencias.get(clave(insumo_id)).toNumber();

const vender = (tx, lineas) =>
    registrarVenta(tx, { referencia: 'v-001', sucursalId: sucursal_id, usuarioId: 1, lineas });

async function debe_fallar_con(promesa, codigo_http) {
    await assert.rejects(promesa, (error) => {
        assert.ok(error instanceof ErrorHttp);
        assert.equal(error.codigoHttp, codigo_http);
        return true;
    });
}

// ---------- calcularImportes ----------

test('calcularImportes separa el iva de un total con iva incluido', () => {
    const { subtotal, iva, total } = calcularImportes([{ precioUnitario: decimal('3.50'), cantidad: 2 }]);

    assert.equal(total.toFixed(2), '7.00');
    assert.equal(subtotal.toFixed(2), '6.19'); // 7.00 / 1.13 = 6.1946...
    assert.equal(iva.toFixed(2), '0.81');
});

test('calcularImportes redondea el subtotal a 2 decimales y subtotal + iva siempre da el total', () => {
    const redondeo_hacia_arriba = calcularImportes([{ precioUnitario: decimal('3.95'), cantidad: 1 }]);
    assert.equal(redondeo_hacia_arriba.subtotal.toFixed(2), '3.50'); // 3.4955...
    assert.equal(redondeo_hacia_arriba.iva.toFixed(2), '0.45');

    const varias_lineas = calcularImportes([
        { precioUnitario: decimal('3.50'), cantidad: 1 },
        { precioUnitario: decimal('3.95'), cantidad: 1 },
        { precioUnitario: decimal('1.25'), cantidad: 3 }
    ]);
    assert.equal(varias_lineas.total.toFixed(2), '11.20');
    assert.equal(varias_lineas.subtotal.toFixed(2), '9.91');
    assert.equal(varias_lineas.iva.toFixed(2), '1.29');
    assert.equal(varias_lineas.subtotal.plus(varias_lineas.iva).toFixed(2), varias_lineas.total.toFixed(2));
});

// ---------- registrarVenta ----------

test('vender 1 latte grande descuenta 18 g de café, 250 ml de leche, 1 vaso, 1 tapadera y 1 viñeta', async () => {
    const { datos, tx } = preparar();
    const venta = await vender(tx, [{ productoId: 1, cantidad: 1 }]);

    assert.equal(stock(datos, 1), 1000 - 18);
    assert.equal(stock(datos, 2), 5000 - 250);
    assert.equal(stock(datos, 3), 100 - 1);
    assert.equal(stock(datos, 4), 100 - 1);
    assert.equal(stock(datos, 5), 100 - 1);

    // un movimiento de salida (negativo) por cada insumo de la receta
    assert.deepEqual(
        tx.registro.movimientos.map((m) => [m.insumoId, m.cantidadCambio.toNumber()]),
        [[1, -18], [2, -250], [3, -1], [4, -1], [5, -1]]
    );
    assert.ok(tx.registro.movimientos.every((m) => m.tipo === 'salida' && m.sucursalId === sucursal_id));

    // el total lleva el iva incluido: 3.50 / 1.13 = 3.10 de base y 0.40 de iva
    assert.equal(venta.total.toFixed(2), '3.50');
    assert.equal(venta.subtotal.toFixed(2), '3.10');
    assert.equal(venta.iva.toFixed(2), '0.40');
});

test('vender 2 lattes multiplica la receta por la cantidad', async () => {
    const { datos, tx } = preparar();
    await vender(tx, [{ productoId: 1, cantidad: 2 }]);

    assert.equal(stock(datos, 1), 1000 - 36);
    assert.equal(stock(datos, 2), 5000 - 500);
    assert.equal(stock(datos, 3), 100 - 2);
    assert.equal(tx.registro.movimientos.find((m) => m.insumoId === 1).cantidadCambio.toNumber(), -36);
});

test('un insumo compartido por dos productos se suma y se descuenta una sola vez', async () => {
    const { datos, tx } = preparar();
    // 1 latte (250 ml de leche) + 2 capuchinos (150 ml cada uno) = 550 ml de leche y 54 g de café
    await vender(tx, [{ productoId: 1, cantidad: 1 }, { productoId: 2, cantidad: 2 }]);

    assert.equal(stock(datos, 1), 1000 - 54);
    assert.equal(stock(datos, 2), 5000 - 550);
    assert.equal(stock(datos, 3), 100 - 3);
    assert.deepEqual(tx.registro.descuentos, [1, 2, 3, 4, 5]); // un solo descuento por insumo, en orden de id
    assert.equal(tx.registro.detalles.length, 2);
});

test('un producto de reventa descuenta 1 unidad de su insumo por cada unidad vendida', async () => {
    const { datos, tx } = preparar();
    await vender(tx, [{ productoId: 3, cantidad: 3 }]);

    assert.equal(stock(datos, 6), 10 - 3);
    assert.equal(stock(datos, 1), 1000); // no toca insumos de recetas
    assert.deepEqual(
        tx.registro.movimientos.map((m) => [m.insumoId, m.cantidadCambio.toNumber()]),
        [[6, -3]]
    );
});

test('un producto elaborado sin receta lanza 409 y no registra nada', async () => {
    const { datos, tx } = preparar();

    await debe_fallar_con(vender(tx, [{ productoId: 4, cantidad: 1 }]), 409);
    assert.equal(tx.registro.ventas.length, 0);
    assert.equal(tx.registro.movimientos.length, 0);
    assert.equal(stock(datos, 1), 1000);
});

test('si la existencia no alcanza lanza 409, indica el insumo y no guarda movimientos', async () => {
    const { datos, tx } = preparar();
    datos.existencias.set(clave(2), decimal(100)); // leche: solo 100 ml y el latte necesita 250

    await assert.rejects(
        () => vender(tx, [{ productoId: 1, cantidad: 1 }]),
        (error) => {
            assert.ok(error instanceof ErrorHttp);
            assert.equal(error.codigoHttp, 409);
            assert.equal(error.detalle.insumoId, 2);
            return true;
        }
    );
    // los movimientos se guardan al final, asi que no se llegó a registrar ninguno.
    // el descuento ya hecho del café lo revierte la transacción real (aqui no hay rollback).
    assert.equal(tx.registro.movimientos.length, 0);
    assert.equal(stock(datos, 2), 100);
});

test('un producto inexistente o desactivado lanza 404', async () => {
    const { tx } = preparar();

    await debe_fallar_con(vender(tx, [{ productoId: 99, cantidad: 1 }]), 404);
    await debe_fallar_con(vender(tx, [{ productoId: 5, cantidad: 1 }]), 404);
    assert.equal(tx.registro.ventas.length, 0);
});

// ---------- ajustarExistencia ----------

const ajustar = (tx, insumo_id, cambio) =>
    ajustarExistencia(tx, { sucursalId: sucursal_id, insumoId: insumo_id, cantidadCambio: decimal(cambio), motivo: 'conteo físico' });

test('un ajuste positivo suma a la existencia y registra el movimiento', async () => {
    const { datos, tx } = preparar();
    await ajustar(tx, 3, 5); // 5 vasos

    assert.equal(stock(datos, 3), 105);
    assert.equal(tx.registro.movimientos.length, 1);
    assert.equal(tx.registro.movimientos[0].tipo, 'ajuste');
    assert.equal(tx.registro.movimientos[0].cantidadCambio.toNumber(), 5);
});

test('un ajuste que dejaría la existencia negativa lanza 409 y no cambia nada', async () => {
    const { datos, tx } = preparar();

    await debe_fallar_con(ajustar(tx, 1, -1500), 409); // hay 1000 g de café
    assert.equal(stock(datos, 1), 1000);
    assert.equal(tx.registro.movimientos.length, 0);
});

test('un ajuste que deja la existencia exactamente en cero es válido', async () => {
    const { datos, tx } = preparar();
    await ajustar(tx, 1, -1000);

    assert.equal(stock(datos, 1), 0);
});

test('un insumo contado por unidad no admite ajustes con decimales (400)', async () => {
    const { datos, tx } = preparar();

    await debe_fallar_con(ajustar(tx, 3, 1.5), 400);
    assert.equal(stock(datos, 3), 100);
    assert.equal(tx.registro.movimientos.length, 0);
});

test('un insumo inactivo o inexistente lanza 404', async () => {
    const { tx } = preparar();

    await debe_fallar_con(ajustar(tx, 7, 10), 404); // insumo retirado
    await debe_fallar_con(ajustar(tx, 99, 10), 404); // no existe
});

test('un insumo sin existencia registrada en la sucursal lanza 404', async () => {
    const { datos, tx } = preparar();
    datos.existencias.delete(clave(1));

    await debe_fallar_con(ajustar(tx, 1, -5), 404);
});