import { Router } from 'express';
import {
    cerrarTurnoCaja, crearCobro, crearMovimiento, crearTurno, listarTurnos, obtenerTurno, obtenerTurnoActual,
} from '../controladores/cajaControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

const enrutador = Router();
enrutador.use(requerirRol('admin', 'gerente', 'cajero'));

enrutador.get('/turnos', listarTurnos);
enrutador.post('/turnos', crearTurno);
enrutador.get('/turnos/actual', obtenerTurnoActual); // antes de '/turnos/:id' para que no se confunda
enrutador.get('/turnos/:id', obtenerTurno);
enrutador.post('/turnos/:id/cobros', crearCobro);
enrutador.post('/turnos/:id/movimientos', crearMovimiento);
enrutador.post('/turnos/:id/cierre', cerrarTurnoCaja);

export default enrutador;
