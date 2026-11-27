import { Router } from 'express';
import { actualizarEmpleado, crearEmpleado, listarEmpleados, obtenerEmpleado } from '../controladores/empleadosControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente'));

enrutador.get('/', listarEmpleados);
enrutador.post('/', crearEmpleado);
enrutador.get('/:id', obtenerEmpleado);
enrutador.patch('/:id', actualizarEmpleado);

export default enrutador;
