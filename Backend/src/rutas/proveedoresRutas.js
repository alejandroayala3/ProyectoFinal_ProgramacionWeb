import { Router } from 'express';
import { actualizarProveedor, crearProveedor, listarProveedores } from '../controladores/comprasControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente'));

enrutador.get('/', listarProveedores);
enrutador.post('/', crearProveedor);
enrutador.patch('/:id', actualizarProveedor);

export default enrutador;
