import { Prisma } from '@prisma/client';

// ISSS: 3% del salario mensual hasta $1,000. LISP, arts. 14 y 16: AFP 7.25%.
const tasa_isss = '0.03';
const tasa_afp = '0.0725';
const techo_isss_mensual = '1000.00';

// Ministerio de Hacienda, Decreto Ejecutivo n.º 10 de 2025, tabla quincenal.
const tramos_renta_quincenal = [
    { hasta: '275.00', exceso_sobre: '0', porcentaje: '0', cuota_fija: '0' },
    { hasta: '447.62', exceso_sobre: '275.00', porcentaje: '0.10', cuota_fija: '8.83' },
    { hasta: '1019.05', exceso_sobre: '447.62', porcentaje: '0.20', cuota_fija: '30.00' },
    { hasta: null, exceso_sobre: '1019.05', porcentaje: '0.30', cuota_fija: '144.28' },
];


// Art. 1, literal f), del mismo decreto. Diciembre acumula desde enero.
const tramos_recalculo = {
    6: [
        { hasta: '3300.00', exceso_sobre: '0', porcentaje: '0', cuota_fija: '0' },
        { hasta: '5371.44', exceso_sobre: '3300.00', porcentaje: '0.10', cuota_fija: '106.20' },
        { hasta: '12228.60', exceso_sobre: '5371.44', porcentaje: '0.20', cuota_fija: '360.00' },
        { hasta: null, exceso_sobre: '12228.60', porcentaje: '0.30', cuota_fija: '1731.42' },
    ],
    12: [
        { hasta: '6600.00', exceso_sobre: '0', porcentaje: '0', cuota_fija: '0' },
        { hasta: '10742.86', exceso_sobre: '6600.00', porcentaje: '0.10', cuota_fija: '212.12' },
        { hasta: '24457.14', exceso_sobre: '10742.86', porcentaje: '0.20', cuota_fija: '720.00' },
        { hasta: null, exceso_sobre: '24457.14', porcentaje: '0.30', cuota_fija: '3462.86' },
    ],
};


export function redondear(valor) {
    return new Prisma.Decimal(valor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function importe_quincenal(total_mensual, quincena) {
    const primera = redondear(total_mensual.div(2));
    return quincena === 1 ? primera : total_mensual.minus(primera);
}

function aplicar_tabla_renta(base, tramos) {
    const tramo = tramos.find(({ hasta }) => hasta === null || base.lte(hasta));
    return redondear(base.minus(tramo.exceso_sobre).mul(tramo.porcentaje).plus(tramo.cuota_fija));
}

export function calcular_renta_quincenal(base_gravada) {
    return aplicar_tabla_renta(new Prisma.Decimal(base_gravada), tramos_renta_quincenal);
}

export function calcular_planilla_empleado(salario_base_mensual, quincena = 1) {
    const mensual = new Prisma.Decimal(salario_base_mensual);
    if (!mensual.isFinite() || !mensual.isPositive() || mensual.decimalPlaces() > 2) {
        throw new RangeError('El salario mensual debe ser positivo y tener hasta dos decimales.');
    }
    if (quincena !== 1 && quincena !== 2) {
        throw new RangeError('La quincena debe ser 1 o 2.');
    }

    const isssMensual = redondear(Prisma.Decimal.min(mensual, techo_isss_mensual).mul(tasa_isss));
    const afpMensual = redondear(mensual.mul(tasa_afp));
    const salario_bruto = importe_quincenal(mensual, quincena);
    const descuento_isss = importe_quincenal(isssMensual, quincena);
    const descuento_afp = importe_quincenal(afpMensual, quincena);
    const base_gravada = salario_bruto.minus(descuento_isss).minus(descuento_afp);
    const descuento_renta = calcular_renta_quincenal(base_gravada);
    const salario_neto = base_gravada.minus(descuento_renta);
    return { salario_bruto, descuento_isss, descuento_afp, descuento_renta, salario_neto };
}


function importe_declarado(valor, campo) {
    if (valor == null || (typeof valor !== 'string' && !Prisma.Decimal.isDecimal(valor))) {
        throw new RangeError(`Falta un importe decimal en ${campo}.`);
    }
    const importe = new Prisma.Decimal(valor);
    if (!importe.isFinite() || importe.lt(0) || importe.decimalPlaces() > 2) {
        throw new RangeError(`${campo} debe ser no negativo y tener hasta dos decimales.`);
    }
    return importe;
}

function sumar_pagos_declarados(pagos, inicio, fin) {
    let base = new Prisma.Decimal(0);
    let retenido = new Prisma.Decimal(0);
    const fechas = new Set();
    for (const pago of pagos) {
        // Cada lista consolida por fecha. Los importes ya excluyen rentas no gravadas,
        // retenciones definitivas y pagos sujetos al 10% del literal h).
        const fecha = typeof pago?.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pago.fecha)
            ? new Date(`${pago.fecha}T00:00:00.000Z`) : null;
        if (!fecha || !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== pago.fecha ||
            fecha < inicio || fecha > fin || fechas.has(pago.fecha)) {
            throw new RangeError('Hay un pago adicional con fecha inválida, fuera del período o duplicada.');
        }
        fechas.add(pago.fecha);
        base = base.plus(importe_declarado(pago.baseGravada, 'baseGravada'));
        retenido = retenido.plus(importe_declarado(pago.rentaRetenida, 'rentaRetenida'));
    }
    return { base, retenido };
}

async function calcular_renta_de_cierre(tx, empleado, periodo, importes, antecedentes) {
    const { periodoInicio, periodoFin } = periodo;
    const anio = periodoInicio.getUTCFullYear();
    const mes = periodoInicio.getUTCMonth() + 1;
    const inicioFiscal = new Date(Date.UTC(anio, 0, 1));
    if (!Array.isArray(antecedentes?.otrosPagos)) {
        throw new RangeError('Confirma los pagos gravados y retenciones adicionales del período con otrosPagos, incluso si la lista está vacía.');
    }
    const extras = sumar_pagos_declarados(antecedentes.otrosPagos, inicioFiscal, periodoFin);
    let base = importes.salario_bruto.minus(importes.descuento_isss).minus(importes.descuento_afp).plus(extras.base);
    let retenido = extras.retenido;
    if (empleado.fechaIngreso > inicioFiscal) {
        const anterior = antecedentes.empleoAnterior;
        if (anterior?.estado === 'con_constancias' && Array.isArray(anterior.pagos) && anterior.pagos.length > 0) {
            const externo = sumar_pagos_declarados(anterior.pagos, inicioFiscal, periodoFin);
            base = base.plus(externo.base);
            retenido = retenido.plus(externo.retenido);
        } else if (anterior?.estado !== 'sin_ingresos' || anterior.pagos !== undefined) {
            throw new RangeError('Confirma que el empleado ingresó sin antecedentes gravados o entrega las constancias de los patronos anteriores.');
        }
    }

    const historial = await tx.detallePlanilla.findMany({
        where: { empleadoId: empleado.id, planilla: { periodoInicio: { gte: inicioFiscal, lt: periodoInicio } } },
        select: { salarioPeriodo: true, isss: true, afp: true, renta: true, planilla: { select: { periodoInicio: true } } },
    });
    const porQuincena = new Map(historial.map((fila) => [fila.planilla.periodoInicio.getTime(), fila]));
    for (let mesAnterior = 0; mesAnterior < mes; mesAnterior++) {
        const quincenas = mesAnterior === mes - 1 ? [1] : [1, 16];
        for (const dia of quincenas) {
            const inicio = new Date(Date.UTC(anio, mesAnterior, dia));
            const fin = dia === 1 ? new Date(Date.UTC(anio, mesAnterior, 15)) : new Date(Date.UTC(anio, mesAnterior + 1, 0));
            if (fin < empleado.fechaIngreso) continue;
            const fila = porQuincena.get(inicio.getTime());
            if (!fila) {
                throw new RangeError(`Historial de planilla incompleto: falta la quincena del ${inicio.toISOString().slice(0, 10)}.`);
            }
            base = base.plus(fila.salarioPeriodo.minus(fila.isss).minus(fila.afp));
            // Incluye lo retenido en la primera quincena del mes de cierre.
            retenido = retenido.plus(fila.renta);
        }
    }

    const tramos = tramos_recalculo[mes];
    if (base.gt(tramos[0].hasta) && base.lte(tramos[1].hasta)) {
        // En junio se necesita el ingreso anual proyectado y en diciembre, el real,
        // confirmado por quien prepara la planilla para determinar la deducción fija.
        const ingresoAnual = importe_declarado(antecedentes.ingresoAnual, 'ingresoAnual para la deducción del tramo II');
        if (ingresoAnual.lt(base)) throw new RangeError('El ingreso anual informado es inferior a la base acumulada.');
        if (ingresoAnual.lte('9100.00')) base = Prisma.Decimal.max(0, base.minus('1600.00'));
    }
    return Prisma.Decimal.max(0, aplicar_tabla_renta(base, tramos).minus(retenido));
}


// Llamar dentro de una transacción interactiva Serializable.
export async function registrarPlanillaQuincenal(tx, { empleadoId, anio, mes, quincena, antecedentesRenta }) {
    if (!Number.isInteger(anio) || anio < 1000 || anio > 9999 ||
        !Number.isInteger(mes) || mes < 1 || mes > 12 || (quincena !== 1 && quincena !== 2)) {
        throw new RangeError('Período quincenal inválido.');
    }
    const periodoInicio = new Date(Date.UTC(anio, mes - 1, quincena === 1 ? 1 : 16));
    const periodoFin = quincena === 1 ? new Date(Date.UTC(anio, mes - 1, 15)) : new Date(Date.UTC(anio, mes, 0));
    const periodo = { periodoInicio, periodoFin };
    const planilla = await tx.planilla.findUnique({ where: { periodoInicio_periodoFin: periodo } });
    if (planilla) {
        const detalle = await tx.detallePlanilla.findUnique({
            where: { planillaId_empleadoId: { planillaId: planilla.id, empleadoId } },
        });
        if (detalle) return { creado: false, detalle };
    }

    const empleado = await tx.empleado.findUnique({ where: { id: empleadoId } });
    if (!empleado?.activo || empleado.fechaIngreso > periodoInicio ||
        (empleado.fechaSalida && empleado.fechaSalida < periodoFin)) {
        throw new RangeError('La planilla ordinaria requiere un empleado activo durante toda la quincena.');
    }

    const importes = calcular_planilla_empleado(empleado.salarioMensual, quincena);
    if (quincena === 2 && (mes === 6 || mes === 12)) {
        importes.descuento_renta = await calcular_renta_de_cierre(tx, empleado, periodo, importes, antecedentesRenta);
        importes.salario_neto = importes.salario_bruto.minus(importes.descuento_isss).minus(importes.descuento_afp)
            .minus(importes.descuento_renta);
        if (importes.salario_neto.lt(0)) {
            throw new RangeError('La retención del recálculo excede el disponible de esta quincena.');
        }
    }
    const cabecera = planilla ?? await tx.planilla.create({ data: periodo });
    const detalle = await tx.detallePlanilla.create({
        data: {
            planillaId: cabecera.id,
            empleadoId,
            salarioPeriodo: importes.salario_bruto,
            isss: importes.descuento_isss,
            afp: importes.descuento_afp,
            renta: importes.descuento_renta,
            neto: importes.salario_neto,
        },
    });
    return { creado: true, detalle };
}
