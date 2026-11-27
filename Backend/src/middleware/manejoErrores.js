import { ErrorHttp } from '../utils/ErrorHttp.js';
import { ErrorCaja } from '../services/caja.service.js';
import { ErrorFacturacion } from '../services/facturacion.service.js';

// Los servicios de caja y facturación lanzan errores con un código de negocio;
// aquí se traduce cada código al estado HTTP correcto.
const estadoPorCodigo = {
    DATO_INVALIDO: 400,
    MONTO_INVALIDO: 400,
    METODO_INVALIDO: 400,
    TIPO_INVALIDO: 400,
    DATOS_INVALIDOS: 400,
    DATOS_CCF: 400,
    CLIENTE_INVALIDO: 400,
    TURNO_INEXISTENTE: 404,
    VENTA_INEXISTENTE: 404,
    APERTURA_INVALIDA: 403,
    VENTA_INVALIDA: 409,
    REFERENCIA_EN_USO: 409,
    TURNO_CERRADO: 409,
    SOBREPAGO: 409,
    VENTA_FACTURADA: 409,
    SERIE_OCUPADA: 409,
    SERIE_AGOTADA: 409,
};

// Errores conocidos de Prisma.
const erroresPrisma = {
    P2002: [409, 'Ya existe un registro con ese valor único'],
    P2003: [409, 'El registro hace referencia a datos que no existen'],
    P2025: [404, 'El registro no existe'],
    P2034: [409, 'Otra operación modificó los mismos datos; vuelve a intentarlo'],
};

export function rutaNoEncontrada(_peticion, respuesta) {
    return respuesta.status(404).json({ mensaje: 'Ruta no encontrada' });
}

export function manejarErrores(error, _peticion, respuesta, _siguiente) {
    if (error?.type === 'entity.parse.failed') {
        return respuesta.status(400).json({ mensaje: 'El cuerpo de la solicitud debe ser JSON válido' });
    }
    if (error instanceof ErrorHttp) {
        return respuesta.status(error.codigoHttp).json({ mensaje: error.message, detalle: error.detalle });
    }
    if (error instanceof ErrorCaja || error instanceof ErrorFacturacion) {
        return respuesta.status(estadoPorCodigo[error.codigo] ?? 409).json({ mensaje: error.message, codigo: error.codigo });
    }
    // El servicio de planilla usa RangeError para períodos o empleados no válidos.
    if (error instanceof RangeError) {
        return respuesta.status(400).json({ mensaje: error.message });
    }
    if (erroresPrisma[error?.code]) {
        const [estado, mensaje] = erroresPrisma[error.code];
        return respuesta.status(estado).json({ mensaje });
    }
    console.error('Error no controlado en la API:', error);
    return respuesta.status(500).json({ mensaje: 'Error interno del servidor' });
}
