import { Router } from 'express';
import { listarProductos } from '../controladores/productosControlador.js';
import { autenticar } from '../middleware/autenticacion.js';

const enrutador = Router();

enrutador.get('/', autenticar, listarProductos);

export default enrutador;
