import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

const variablesRequeridas = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const faltantes = variablesRequeridas.filter((nombre) => !process.env[nombre]);
if (faltantes.length > 0) {
    throw new Error(`Faltan variables en Backend/.env: ${faltantes.join(', ')}`);
}

const adaptador = new PrismaMssql({
    server: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 1433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true }
});

const prisma = new PrismaClient({ adapter: adaptador });

export default prisma;