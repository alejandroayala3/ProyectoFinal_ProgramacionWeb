import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ErrorCargaDemo, confirmarCargaDemo } from './destinoDemo.js';

const pasos = [
    'seed.js',
    'cargarSucursales.js',
    'cargarUsuariosDemo.js',
    'cargarEntradas.js',
    'cargarPlatosPrincipales.js',
    'cargarHamburguesasYBebidas.js',
    'cargarReventas.js',
    'cargarInventarioInicial.js',
    'cargarCompraPrueba.js',
    'cargarVentaPrueba.js',
    'cargarCajaPrueba.js',
    'cargarFacturaPrueba.js',
    'cargarPlanillaPrueba.js',
];

try {
    const { destino } = confirmarCargaDemo();
    console.log(`Carga de demostración en ${destino}`);
    for (const paso of pasos) {
        console.log(`Ejecutando ${paso}`);
        const archivo = fileURLToPath(new URL(paso, import.meta.url));
        const resultado = spawnSync(process.execPath, [archivo, `--confirmar-demo=${destino}`], {
            stdio: 'inherit',
        });
        if (resultado.status !== 0) {
            throw new ErrorCargaDemo(`Carga detenida en ${paso}.`);
        }
    }
} catch (error) {
    console.error(error instanceof ErrorCargaDemo ? error.message : 'No se pudo ejecutar la carga de demostración.');
    process.exitCode = 1;
}
