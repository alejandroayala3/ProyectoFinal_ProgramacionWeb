import { Router } from 'express';
import { listarSucursales } from '../controladores/sucursalesControlador.js';

const enrutador = Router();

enrutador.get('/', listarSucursales);

export default enrutador;
