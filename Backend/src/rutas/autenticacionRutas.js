import { Router } from 'express';
import { iniciarSesion, obtenerSesion } from '../controladores/autenticacionControlador.js';
import { autenticar } from '../middleware/autenticacion.js';

const enrutador = Router();

enrutador.post('/login', iniciarSesion);
enrutador.get('/sesion', autenticar, obtenerSesion);

export default enrutador;