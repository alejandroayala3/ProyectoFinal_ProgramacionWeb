import { Router } from 'express';
import { listarProductos, obtenerProducto } from '../controladores/productosControlador.js';

// La autenticación se aplica al montar el enrutador en app.js.
const enrutador = Router();

enrutador.get('/', listarProductos);
enrutador.get('/:id', obtenerProducto);

export default enrutador;
