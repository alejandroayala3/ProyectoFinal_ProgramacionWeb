// pruebas de planilla, cierre de caja y abonos de compras, sin base de datos.
// los servicios reciben un tx falso en memoria que implementa solo las consultas que usan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calcular_planilla_empleado, calcular_renta_quincenal } from '../src/services/planilla.service.js';
import { cerrarTurno, ErrorCaja } from '../src/services/caja.service.js';
import { calcularImportesCompra, registrarPagoCompra } from '../src/services/compra.service.js';
import { ErrorHttp } from '../src/utils/ErrorHttp.js';

const decimal = (valor) => new Prisma.Decimal(valor);

// convierte el resultado de la planilla a texto con 2 decimales para comparar
function en_texto(resultado) {
    return Object.fromEntries(Object.entries(resultado).map(([campo, valor]) => [campo, valor.toFixed(2)]));
}

// ---------- planilla ----------

test('planilla: salario bajo de $400 no paga renta y solo descuenta isss y afp', () => {
    const planilla = calcular_planilla_empleado('400.00', 1);

    assert.deepEqual(en_texto(planilla), {
        salario_bruto: '200.00',
        descuento_isss: '6.00', // 3% de 400 = 12.00 al mes, mitad por quincena
        descuento_afp: '14.50', // 7.25% de 400 = 29.00 al mes, mitad por quincena
        descuento_renta: '0.00', // base gravada 179.50, dentro del tramo exento (hasta 275.00)
        salario_neto: '179.50'
    });
});

test('planilla: salario de $800 cae en el tramo del 10% de renta', () => {
    const planilla = calcular_planilla_empleado('800.00', 1);

    assert.deepEqual(en_texto(planilla), {
        salario_bruto: '400.00',
        descuento_isss: '12.00',
        descuento_afp: '29.00',
        descuento_renta: '17.23', // 8.83 + (359.00 - 275.00) x 10%
        salario_neto: '341.77'
    });
});

test('planilla: salario de $1,000 llega justo al tope del isss y entra al tramo del 20%', () => {
    const planilla = calcular_planilla_empleado('1000.00', 1);

    assert.deepEqual(en_texto(planilla), {
        salario_bruto: '500.00',
        descuento_isss: '15.00', // tope: 3% de 1,000 = 30.00 al mes
        descuento_afp: '36.25',
        descuento_renta: '30.23', // 30.00 + (448.75 - 447.62) x 20%
        salario_neto: '418.52'
    });
});

test('planilla: sobre el tope de $1,000 el isss no sigue subiendo pero el afp sí', () => {
    const planilla = calcular_planilla_empleado('2000.00', 1);

    assert.equal(planilla.descuento_isss.toFixed(2), '15.00'); // igual que con $1,000
    assert.equal(planilla.descuento_afp.toFixed(2), '72.50'); // 7.25% de 2,000 = 145.00 al mes
    assert.equal(planilla.descuento_renta.toFixed(2), '122.98'); // 30.00 + (912.50 - 447.62) x 20%
    assert.equal(planilla.salario_neto.toFixed(2), '789.52');
});

test('planilla: salario de $3,000 llega al tramo alto del 30% de renta', () => {
    const planilla = calcular_planilla_empleado('3000.00', 1);

    assert.deepEqual(en_texto(planilla), {
        salario_bruto: '1500.00',
        descuento_isss: '15.00',
        descuento_afp: '108.75',
        descuento_renta: '251.44', // 144.28 + (1,376.25 - 1,019.05) x 30%
        salario_neto: '1124.81'
    });
});

test('planilla: las dos quincenas suman exactamente el salario mensual aunque haya centavos impares', () => {
    const primera = calcular_planilla_empleado('1000.01', 1);
    const segunda = calcular_planilla_empleado('1000.01', 2);

    assert.equal(primera.salario_bruto.toFixed(2), '500.01'); // la primera quincena redondea hacia arriba
    assert.equal(segunda.salario_bruto.toFixed(2), '500.00');
    assert.equal(primera.salario_bruto.plus(segunda.salario_bruto).toFixed(2), '1000.01');
});

test('planilla: rechaza salarios negativos, con más de 2 decimales y quincenas inválidas', () => {
    assert.throws(() => calcular_planilla_empleado('-100.00'), RangeError);
    assert.throws(() => calcular_planilla_empleado('500.123'), RangeError);
    assert.throws(() => calcular_planilla_empleado('500.00', 3), RangeError);
});

test('renta quincenal: respeta los límites de los tramos de la tabla', () => {
    assert.equal(calcular_renta_quincenal('275.00').toFixed(2), '0.00'); // el límite exento no paga
    assert.equal(calcular_renta_quincenal('275.01').toFixed(2), '8.83'); // apenas pasa al tramo del 10%
    assert.equal(calcular_renta_quincenal('1019.06').toFixed(2), '144.28'); // apenas pasa al tramo del 30%
});

// ---------- caja: cierre de turno ----------

// agrupa filas por un campo y suma el monto, como hace groupBy de prisma
function agrupar_sumando(filas, campo, turno_id) {
    const sumas = new Map();
    for (const fila of filas.filter((f) => f.turnoId === turno_id)) {
        sumas.set(fila[campo], (sumas.get(fila[campo]) ?? decimal(0)).plus(fila.monto));
    }
    return [...sumas].map(([valor, monto]) => ({ [campo]: valor, _sum: { monto } }));
}

function crear_tx_caja() {
    const turnos = new Map([
        [1, { id: 1, fondoInicial: decimal('50.00'), fechaCierre: null, efectivoContado: null }],
        [2, { id: 2, fondoInicial: decimal('10.00'), fechaCierre: null, efectivoContado: null }],
        [3, { id: 3, fondoInicial: decimal('80.00'), fechaCierre: null, efectivoContado: null }],
        [4, { id: 4, fondoInicial: decimal('50.00'), fechaCierre: new Date(), efectivoContado: decimal('155.00') }]
    ]);
    const cobros = [
        { turnoId: 1, metodo: 'efectivo', monto: decimal('60.00') },
        { turnoId: 1, metodo: 'efectivo', monto: decimal('40.00') },
        { turnoId: 1, metodo: 'tarjeta', monto: decimal('40.00') },
        { turnoId: 1, metodo: 'digital', monto: decimal('10.00') },
        { turnoId: 1, metodo: 'bitcoin', monto: decimal('25.00') },
        { turnoId: 2, metodo: 'efectivo', monto: decimal('999.00') } // de otro turno: no debe contarse
    ];
    const movimientos = [
        { turnoId: 1, tipo: 'entrada', monto: decimal('20.00') },
        { turnoId: 1, tipo: 'salida', monto: decimal('15.00') }
    ];
    return {
        turnos,
        $queryRaw: async (_texto, turno_id) => (turnos.has(turno_id) ? [{ id: turno_id }] : []),
        turnoCaja: {
            findUniqueOrThrow: async ({ where }) => turnos.get(where.id),
            update: async ({ where, data }) => {
                const actualizado = { ...turnos.get(where.id), ...data };
                turnos.set(where.id, actualizado);
                return actualizado;
            }
        },
        cobroVenta: { groupBy: async ({ by: [campo], where }) => agrupar_sumando(cobros, campo, where.turnoId) },
        movimientoCaja: { groupBy: async ({ by: [campo], where }) => agrupar_sumando(movimientos, campo, where.turnoId) }
    };
}

test('caja: el efectivo esperado suma fondo, cobros en efectivo y entradas, y resta las salidas', async () => {
    const tx = crear_tx_caja();
    const turno = await cerrarTurno(tx, { turnoId: 1, efectivoContado: '155.00' });

    // 50.00 de fondo + 100.00 en efectivo + 20.00 de entradas - 15.00 de salidas
    assert.equal(turno.efectivoEsperado.toFixed(2), '155.00');
});

test('caja: si el contado es menor al esperado la diferencia es negativa (faltante)', async () => {
    const tx = crear_tx_caja();
    const turno = await cerrarTurno(tx, { turnoId: 1, efectivoContado: '150.00' });

    assert.equal(turno.diferencia.toFixed(2), '-5.00'); // 150.00 - 155.00
});

test('caja: si el contado es mayor al esperado la diferencia es positiva (sobrante)', async () => {
    const tx = crear_tx_caja();
    const turno = await cerrarTurno(tx, { turnoId: 1, efectivoContado: '160.00' });

    assert.equal(turno.diferencia.toFixed(2), '5.00'); // 160.00 - 155.00
});

test('caja: si el contado coincide con el esperado la diferencia es cero', async () => {
    const tx = crear_tx_caja();
    const turno = await cerrarTurno(tx, { turnoId: 1, efectivoContado: '155.00' });

    assert.equal(turno.diferencia.toFixed(2), '0.00');
});

test('caja: el cierre separa los totales de tarjeta, pagos digitales y bitcoin, y deja el turno cerrado', async () => {
    const tx = crear_tx_caja();
    const turno = await cerrarTurno(tx, { turnoId: 1, efectivoContado: '155.00' });

    assert.equal(turno.totalTarjeta.toFixed(2), '40.00');
    assert.equal(turno.totalDigital.toFixed(2), '10.00');
    assert.equal(turno.totalBitcoin.toFixed(2), '25.00');
    assert.ok(turno.fechaCierre instanceof Date);
    assert.equal(tx.turnos.get(1).fechaCierre, turno.fechaCierre);
});

test('caja: un turno sin ventas ni movimientos espera solo el fondo inicial y sus totales quedan en cero', async () => {
    const tx = crear_tx_caja();
    const turno = await cerrarTurno(tx, { turnoId: 3, efectivoContado: '80.00' });

    assert.equal(turno.efectivoEsperado.toFixed(2), '80.00');
    assert.equal(turno.diferencia.toFixed(2), '0.00');
    assert.equal(turno.totalTarjeta.toFixed(2), '0.00');
    assert.equal(turno.totalBitcoin.toFixed(2), '0.00');
});

test('caja: los cobros de otro turno no entran en el cuadre', async () => {
    const tx = crear_tx_caja();
    const turno = await cerrarTurno(tx, { turnoId: 2, efectivoContado: '1009.00' });

    // el turno 2 tiene su propio cobro de 999.00 y 10.00 de fondo; nada del turno 1
    assert.equal(turno.efectivoEsperado.toFixed(2), '1009.00');
    assert.equal(turno.diferencia.toFixed(2), '0.00');
});

test('caja: cerrar de nuevo un turno cerrado con el mismo monto es idempotente, con otro monto falla', async () => {
    const tx = crear_tx_caja();

    const repetido = await cerrarTurno(tx, { turnoId: 4, efectivoContado: '155.00' });
    assert.equal(repetido.efectivoContado.toFixed(2), '155.00');

    await assert.rejects(
        () => cerrarTurno(tx, { turnoId: 4, efectivoContado: '100.00' }),
        (error) => error instanceof ErrorCaja && error.codigo === 'TURNO_CERRADO'
    );
});

test('caja: rechaza un turno inexistente y montos contados inválidos', async () => {
    const tx = crear_tx_caja();

    await assert.rejects(
        () => cerrarTurno(tx, { turnoId: 99, efectivoContado: '10.00' }),
        (error) => error instanceof ErrorCaja && error.codigo === 'TURNO_INEXISTENTE'
    );
    await assert.rejects(
        () => cerrarTurno(tx, { turnoId: 1, efectivoContado: '-5.00' }),
        (error) => error instanceof ErrorCaja && error.codigo === 'MONTO_INVALIDO'
    );
    await assert.rejects(
        () => cerrarTurno(tx, { turnoId: 1, efectivoContado: '10.505' }),
        (error) => error instanceof ErrorCaja && error.codigo === 'MONTO_INVALIDO'
    );
});

// ---------- compras ----------

function crear_tx_compra() {
    const compras = new Map([[7, { id: 7, total: decimal('113.00') }]]); // 100.00 + 13% de iva
    const pagos = [{ compraId: 7, monto: decimal('50.00') }]; // ya se abonaron 50.00: quedan 63.00
    const creados = [];
    return {
        creados,
        $queryRaw: async (_texto, compra_id) => (compras.has(compra_id) ? [{ id: compra_id }] : []),
        compra: { findUniqueOrThrow: async ({ where }) => compras.get(where.id) },
        pagoCompra: {
            aggregate: async ({ where }) => {
                const de_la_compra = pagos.filter((pago) => pago.compraId === where.compraId);
                const suma = de_la_compra.length ? de_la_compra.reduce((total, pago) => total.plus(pago.monto), decimal(0)) : null;
                return { _sum: { monto: suma } };
            },
            create: async ({ data }) => {
                creados.push(data);
                return { id: creados.length, ...data };
            }
        }
    };
}

test('compras: un abono mayor al saldo lanza 409 con el saldo pendiente en el mensaje', async () => {
    const tx = crear_tx_compra();

    await assert.rejects(
        () => registrarPagoCompra(tx, { compraId: 7, metodo: 'transferencia', monto: decimal('63.01') }),
        (error) => {
            assert.ok(error instanceof ErrorHttp);
            assert.equal(error.codigoHttp, 409);
            assert.equal(error.message, 'El pago supera el saldo pendiente de $63.00');
            return true;
        }
    );
    assert.equal(tx.creados.length, 0); // no se guardó ningún abono
});

test('compras: un abono igual al saldo pendiente es válido y salda la cuenta', async () => {
    const tx = crear_tx_compra();
    const pago = await registrarPagoCompra(tx, { compraId: 7, metodo: 'transferencia', monto: decimal('63.00'), referencia: 'abono-2' });

    assert.equal(pago.monto.toFixed(2), '63.00');
    assert.equal(pago.referencia, 'abono-2');
    assert.equal(tx.creados.length, 1);
});

test('compras: un abono parcial menor al saldo se registra', async () => {
    const tx = crear_tx_compra();
    const pago = await registrarPagoCompra(tx, { compraId: 7, metodo: 'efectivo', monto: decimal('20.00') });

    assert.equal(pago.compraId, 7);
    assert.equal(pago.monto.toFixed(2), '20.00');
    assert.ok(pago.referencia.startsWith('PAGO-')); // si no se envía referencia, se genera una
});

test('compras: sin abonos previos el saldo es el total de la compra', async () => {
    const tx = crear_tx_compra();
    tx.$queryRaw = async () => [{ id: 8 }];
    tx.compra.findUniqueOrThrow = async () => ({ id: 8, total: decimal('28.25') });

    await assert.rejects(
        () => registrarPagoCompra(tx, { compraId: 8, metodo: 'efectivo', monto: decimal('28.26') }),
        (error) => error instanceof ErrorHttp && error.codigoHttp === 409 &&
            error.message === 'El pago supera el saldo pendiente de $28.25'
    );
});

test('compras: abonar a una compra inexistente lanza 404', async () => {
    const tx = crear_tx_compra();

    await assert.rejects(
        () => registrarPagoCompra(tx, { compraId: 99, metodo: 'efectivo', monto: decimal('5.00') }),
        (error) => error instanceof ErrorHttp && error.codigoHttp === 404
    );
});

test('compras: calcularImportesCompra suma los renglones y agrega el 13% de iva', () => {
    const importes = calcularImportesCompra([
        { cantidad: decimal(2000), costoUnitario: decimal('0.020000') }, // 40.00 de café
        { cantidad: decimal(10000), costoUnitario: decimal('0.001500') } // 15.00 de leche
    ]);

    assert.equal(importes.subtotal.toFixed(2), '55.00');
    assert.equal(importes.iva.toFixed(2), '7.15');
    assert.equal(importes.total.toFixed(2), '62.15');
});