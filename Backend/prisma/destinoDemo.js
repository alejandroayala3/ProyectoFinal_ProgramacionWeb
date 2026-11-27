import 'dotenv/config';

export class ErrorCargaDemo extends Error {}

export function confirmarCargaDemo(argumentos = process.argv.slice(2)) {
    const base = process.env.DB_NAME;
    const host = process.env.DB_HOST;
    const puerto = Number(process.env.DB_PORT ?? 1433);
    if (!base?.trim() || !host?.trim() || !Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
        throw new ErrorCargaDemo('Configura DB_HOST, DB_NAME y un puerto TCP válido en DB_PORT antes de cargar datos demo.');
    }

    const destino = `${host}:${puerto}/${base}`;
    const confirmacion = `--confirmar-demo=${destino}`;
    if (argumentos.length !== 1 || argumentos[0] !== confirmacion) {
        throw new ErrorCargaDemo(`Confirma explícitamente el destino con "${confirmacion}". Usa una base destinada a demostración.`);
    }

    return { base, puerto, destino };
}

export async function verificarDestinoDemo(tx, { base, puerto }) {
    const [conexion] = await tx.$queryRaw`
        SELECT DB_NAME() AS base, CONVERT(int, CONNECTIONPROPERTY('local_tcp_port')) AS puerto
    `;
    if (conexion?.base !== base || conexion.puerto !== puerto) {
        throw new ErrorCargaDemo('La conexión SQL no corresponde a la base y puerto confirmados.');
    }
}
