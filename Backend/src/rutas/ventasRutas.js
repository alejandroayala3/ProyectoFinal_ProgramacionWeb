import { Router } from 'express';
import { crearVenta, listarVentas, obtenerVenta } from '../controladores/ventasControlador.js';
import { emitirDocumento } from '../controladores/facturacionControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente', 'cajero'));

enrutador.get('/', listarVentas);
enrutador.post('/', crearVenta);
enrutador.get('/:id', obtenerVenta);
enrutador.post('/:id/documento', emitirDocumento);

export default enrutador;
