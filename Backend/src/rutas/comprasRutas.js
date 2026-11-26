import { Router } from 'express';
import { crearCompra, crearPagoCompra, listarCompras, obtenerCompra } from '../controladores/comprasControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente'));

enrutador.get('/', listarCompras);
enrutador.post('/', crearCompra);
enrutador.get('/:id', obtenerCompra);
enrutador.post('/:id/pagos', crearPagoCompra);

export default enrutador;
