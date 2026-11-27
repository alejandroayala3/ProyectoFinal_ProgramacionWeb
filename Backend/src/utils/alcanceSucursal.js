import { ErrorHttp } from './ErrorHttp.js';
import { enteroOpcional } from './validacion.js';

// Reglas de sucursal según el token JWT:
// - El administrador opera en cualquier sucursal (puede indicar sucursalId).
// - Los demás roles solo operan en la sucursal asignada a su usuario.

export const rolesGestion = ['admin', 'gerente'];

export function esAdmin(auth) {
    return auth?.rol === 'admin';
}

// Sucursal en la que se registra una operación (venta, compra, turno...).
export function sucursalOperacion(auth, solicitada) {
    const pedida = enteroOpcional(solicitada, 'La sucursal');
    if (esAdmin(auth)) {
        const sucursalId = pedida ?? auth.sucursalId;
        if (!sucursalId) throw new ErrorHttp(400, 'Indica la sucursal de la operación');
        return sucursalId;
    }
    if (!auth.sucursalId) throw new ErrorHttp(403, 'Tu usuario no tiene una sucursal asignada');
    if (pedida !== null && pedida !== auth.sucursalId) {
        throw new ErrorHttp(403, 'Solo puedes operar en tu sucursal');
    }
    return auth.sucursalId;
}

// Filtro para consultas: el administrador ve todas si no indica una.
export function filtroSucursal(auth, solicitada) {
    const pedida = enteroOpcional(solicitada, 'La sucursal');
    if (esAdmin(auth)) return pedida ?? undefined;
    return sucursalOperacion(auth, pedida);
}

// Para registros ya existentes: impide ver o tocar los de otra sucursal.
export function verificarSucursal(auth, sucursalId) {
    if (!esAdmin(auth) && auth.sucursalId !== sucursalId) {
        throw new ErrorHttp(403, 'El registro pertenece a otra sucursal');
    }
}

// Un cajero solo usa su propio turno; gerente y administrador pueden supervisar.
export function verificarAccesoTurno(auth, turno) {
    if (!turno) throw new ErrorHttp(404, 'El turno no existe');
    verificarSucursal(auth, turno.sucursalId);
    if (!rolesGestion.includes(auth.rol) && turno.usuarioId !== auth.idUsuario) {
        throw new ErrorHttp(403, 'El turno pertenece a otro usuario');
    }
}
