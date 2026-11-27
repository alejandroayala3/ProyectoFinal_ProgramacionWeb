import { Router } from 'express';
import {
    actualizarInsumo, actualizarMinimo, crearAjuste, crearInsumo, listarAlertas,
    listarExistencias, listarInsumos, listarMovimientos,
} from '../controladores/inventarioControlador.js';
import { requerirRol } from '../middleware/autenticacion.js';

// Cualquier usuario autenticado consulta; solo gerencia modifica.
const enrutador = Router();
const soloGestion = requerirRol('admin', 'gerente');

enrutador.get('/insumos', listarInsumos);
enrutador.post('/insumos', soloGestion, crearInsumo);
enrutador.patch('/insumos/:id', soloGestion, actualizarInsumo);
enrutador.get('/existencias', listarExistencias);
enrutador.patch('/existencias/:insumoId', soloGestion, actualizarMinimo);
enrutador.get('/alertas', listarAlertas);
enrutador.get('/movimientos', listarMovimientos);
enrutador.post('/ajustes', soloGestion, crearAjuste);

export default enrutador;
