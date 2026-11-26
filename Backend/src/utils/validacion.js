import { Prisma } from '@prisma/client';
import { ErrorHttp } from './ErrorHttp.js';

// Validadores reutilizables por los controladores. Todos lanzan ErrorHttp 400
// con un mensaje claro para que el frontend lo muestre tal cual.

export function enteroPositivo(valor, etiqueta) {
    const numero = typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
    if (!Number.isInteger(numero) || numero < 1 || numero > 2147483647) {
        throw new ErrorHttp(400, `${etiqueta} debe ser un número entero positivo`);
    }
    return numero;
}

export function enteroOpcional(valor, etiqueta) {
    return valor === undefined || valor === null || valor === '' ? null : enteroPositivo(valor, etiqueta);
}

export function textoRequerido(valor, maximo, etiqueta) {
    if (typeof valor !== 'string' || !valor.trim()) {
        throw new ErrorHttp(400, `${etiqueta} es obligatorio`);
    }
    const texto = valor.trim();
    if (texto.length > maximo) {
        throw new ErrorHttp(400, `${etiqueta} admite como máximo ${maximo} caracteres`);
    }
    return texto;
}

export function textoOpcional(valor, maximo, etiqueta) {
    if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) return null;
    return textoRequerido(valor, maximo, etiqueta);
}

// Convierte a Decimal exacto (nunca a float) para montos y cantidades.
export function decimal(valor, etiqueta, { decimales = 2, permiteCero = false, permiteNegativo = false } = {}) {
    let numero;
    try {
        if (typeof valor !== 'number' && typeof valor !== 'string') throw new Error();
        numero = new Prisma.Decimal(valor);
    } catch {
        throw new ErrorHttp(400, `${etiqueta} debe ser un número válido`);
    }
    if (!numero.isFinite() || numero.decimalPlaces() > decimales || numero.abs().gt('9999999999')) {
        throw new ErrorHttp(400, `${etiqueta} admite hasta ${decimales} decimales`);
    }
    if ((!permiteNegativo && numero.isNegative()) || (!permiteCero && numero.isZero())) {
        throw new ErrorHttp(400, `${etiqueta} debe ser ${permiteCero ? 'cero o mayor' : 'mayor que cero'}`);
    }
    return numero;
}

// Fecha de calendario 'AAAA-MM-DD' en UTC, igual que las columnas DATE de Prisma.
export function fecha(valor, etiqueta) {
    const coincide = typeof valor === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
    const resultado = coincide && new Date(Date.UTC(Number(coincide[1]), Number(coincide[2]) - 1, Number(coincide[3])));
    if (!resultado || resultado.toISOString().slice(0, 10) !== valor.trim()) {
        throw new ErrorHttp(400, `${etiqueta} debe tener el formato AAAA-MM-DD`);
    }
    return resultado;
}

export function booleanoOpcional(valor, etiqueta) {
    if (valor === undefined || valor === null || valor === '') return null;
    if (valor === true || valor === 'true') return true;
    if (valor === false || valor === 'false') return false;
    throw new ErrorHttp(400, `${etiqueta} debe ser true o false`);
}

export function opcion(valor, permitidas, etiqueta) {
    if (!permitidas.includes(valor)) {
        throw new ErrorHttp(400, `${etiqueta} debe ser uno de: ${permitidas.join(', ')}`);
    }
    return valor;
}

export function arreglo(valor, etiqueta, { minimo = 1, maximo = 100 } = {}) {
    if (!Array.isArray(valor) || valor.length < minimo || valor.length > maximo) {
        throw new ErrorHttp(400, `${etiqueta} debe ser una lista de ${minimo} a ${maximo} elementos`);
    }
    return valor;
}

export function limite(valor, porDefecto = 50, maximo = 200) {
    if (valor === undefined || valor === '') return porDefecto;
    return Math.min(enteroPositivo(valor, 'El límite'), maximo);
}

// Filtro de rango de fechas: incluye todo el día 'hasta'.
export function rangoFechas(desde, hasta) {
    const filtro = {};
    if (desde) filtro.gte = fecha(desde, 'La fecha desde');
    if (hasta) {
        const fin = fecha(hasta, 'La fecha hasta');
        fin.setUTCDate(fin.getUTCDate() + 1);
        filtro.lt = fin;
    }
    return Object.keys(filtro).length ? filtro : undefined;
}
