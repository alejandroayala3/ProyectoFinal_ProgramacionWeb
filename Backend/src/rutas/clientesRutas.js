import { Router } from 'express';
import { actualizarCliente, crearCliente, listarClientes, obtenerCliente } from '../controladores/clientesControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente', 'cajero'));

enrutador.get('/', listarClientes);
enrutador.post('/', crearCliente);
enrutador.get('/:id', obtenerCliente);
enrutador.patch('/:id', actualizarCliente);

export default enrutador;
