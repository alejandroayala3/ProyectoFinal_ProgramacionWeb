import jwt from 'jsonwebtoken';
import { ErrorHttp } from '../utils/ErrorHttp.js';

export function autenticar(peticion, _respuesta, siguiente) {
    const [esquema, token] = (peticion.get('Authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
        throw new ErrorHttp(401, 'Falta el token de autenticación');
    }
    try {
        peticion.auth = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        throw new ErrorHttp(401, 'La sesión no es válida o expiró');
    }
    return siguiente();
}

export function requerirRol(...rolesPermitidos) {
    return (peticion, _respuesta, siguiente) => {
        if (!rolesPermitidos.includes(peticion.auth?.rol)) {
            throw new ErrorHttp(403, 'No tienes permiso para realizar esta acción');
        }
        return siguiente();
    };
}