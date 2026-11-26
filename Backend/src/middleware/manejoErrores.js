import { ErrorHttp } from '../utils/ErrorHttp.js';

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
    if (error?.code === 'P2002') {
        return respuesta.status(409).json({ mensaje: 'Ya existe un registro con ese valor único' });
    }
    console.error('Error no controlado en la API:', error);
    return respuesta.status(500).json({ mensaje: 'Error interno del servidor' });
}