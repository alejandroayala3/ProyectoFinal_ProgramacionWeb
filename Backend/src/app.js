import express from 'express';
import cors from 'cors';
import prisma from './config/prisma.js';
import rutasAutenticacion from './rutas/autenticacionRutas.js';
import rutasProductos from './rutas/productosRutas.js';
import { rutaNoEncontrada, manejarErrores } from './middleware/manejoErrores.js';

const app = express();
app.use(cors());
app.use(express.json());

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
app.use('/api/productos', rutasProductos);

// Aquí montan sus rutas Persona 2 y los demás: app.use('/api/ventas', autenticar, rutasVentas);

app.use(rutaNoEncontrada);
app.use(manejarErrores);

export default app;