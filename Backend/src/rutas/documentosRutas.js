import { Router } from 'express';
import { listarDocumentos, obtenerDocumento } from '../controladores/facturacionControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente', 'cajero'));

enrutador.get('/', listarDocumentos);
enrutador.get('/:id', obtenerDocumento);

export default enrutador;
