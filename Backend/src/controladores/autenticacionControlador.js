import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { ErrorHttp } from '../utils/ErrorHttp.js';

export async function iniciarSesion(peticion, respuesta) {
    const { correo, password } = peticion.body ?? {};
    if (typeof correo !== 'string' || !correo.trim() || typeof password !== 'string' || !password) {
        throw new ErrorHttp(400, 'El correo y la contraseña son obligatorios');
    }

    const usuario = await prisma.usuario.findUnique({
        where: { correo: correo.trim().toLowerCase() },
        include: { rol: true }
    });
    const credencialesValidas = usuario?.activo &&
        await bcrypt.compare(password, usuario.passwordHash);
    if (!credencialesValidas) {
        throw new ErrorHttp(401, 'Credenciales incorrectas');
    }

    const token = jwt.sign(
        { idUsuario: usuario.id, rol: usuario.rol.codigo, sucursalId: usuario.sucursalId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRA_EN ?? '8h' }
    );
    return respuesta.json({
        mensaje: 'Inicio de sesión exitoso',
        token,
        usuario: {
            id: usuario.id,
            nombreCompleto: usuario.nombreCompleto,
            correo: usuario.correo,
            rol: usuario.rol.codigo,
            sucursalId: usuario.sucursalId
        }
    });
}

export async function obtenerSesion(peticion, respuesta) {
    const usuario = await prisma.usuario.findUnique({
        where: { id: peticion.auth.idUsuario },
        select: { id: true, nombreCompleto: true, correo: true, sucursalId: true, rol: { select: { codigo: true } } }
    });
    if (!usuario) throw new ErrorHttp(404, 'Usuario no encontrado');
    return respuesta.json({ usuario });
}