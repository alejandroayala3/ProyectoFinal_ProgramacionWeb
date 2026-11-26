import express from 'express';
import cors from 'cors';
import prisma from './config/prisma.js';
import rutasAutenticacion from './rutas/autenticacionRutas.js';
import rutasProductos from './rutas/productosRutas.js';
import rutasSucursales from './rutas/sucursalesRutas.js';
import rutasVentas from './rutas/ventasRutas.js';
import rutasDocumentos from './rutas/documentosRutas.js';
import rutasClientes from './rutas/clientesRutas.js';
import rutasCaja from './rutas/cajaRutas.js';
import rutasInventario from './rutas/inventarioRutas.js';
import rutasProveedores from './rutas/proveedoresRutas.js';
import rutasCompras from './rutas/comprasRutas.js';
import rutasEmpleados from './rutas/empleadosRutas.js';
import rutasPlanillas from './rutas/planillasRutas.js';
import { autenticar } from './middleware/autenticacion.js';
import { rutaNoEncontrada, manejarErrores } from './middleware/manejoErrores.js';

const app = express();
app.use(cors());
app.use(express.json());
// Los id de movimientos son BigInt y JSON no los admite: se envían como texto.
app.set('json replacer', (_clave, valor) => (typeof valor === 'bigint' ? valor.toString() : valor));

app.get('/api/salud', async (_peticion, respuesta) => {
    try {
        await prisma.$queryRaw`SELECT 1 AS disponible`;
        return respuesta.json({ estado: 'ok', baseDatos: 'conectada' });
    } catch (error) {
        console.error('Fallo la consulta de salud a la base de datos:', error);
        return respuesta.status(503).json({ estado: 'error', baseDatos: 'no disponible' });
    }
});

app.use('/api/auth', rutasAutenticacion);

// Todo lo siguiente exige sesión; cada enrutador define además qué roles acceden.
app.use('/api/productos', autenticar, rutasProductos);
app.use('/api/sucursales', autenticar, rutasSucursales);
app.use('/api/ventas', autenticar, rutasVentas);
app.use('/api/documentos', autenticar, rutasDocumentos);
app.use('/api/clientes', autenticar, rutasClientes);
app.use('/api/caja', autenticar, rutasCaja);
app.use('/api/inventario', autenticar, rutasInventario);
app.use('/api/proveedores', autenticar, rutasProveedores);
app.use('/api/compras', autenticar, rutasCompras);
app.use('/api/empleados', autenticar, rutasEmpleados);
app.use('/api/planillas', autenticar, rutasPlanillas);

app.use(rutaNoEncontrada);
app.use(manejarErrores);

export default app;