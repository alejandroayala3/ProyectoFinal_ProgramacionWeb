import { Router } from 'express';
import { generarPlanilla, listarPlanillas, obtenerPlanilla, simularPlanilla } from '../controladores/planillasControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente'));

enrutador.get('/', listarPlanillas);
enrutador.post('/', generarPlanilla);
enrutador.post('/simulacion', simularPlanilla);
enrutador.get('/:id', obtenerPlanilla);

export default enrutador;
