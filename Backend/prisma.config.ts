import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const { DB_HOST = 'localhost', DB_PORT = '1433', DB_NAME, DB_USER, DB_PASSWORD } = process.env;
const url = `sqlserver://${DB_HOST}:${DB_PORT};database=${DB_NAME};user=${DB_USER};password=${DB_PASSWORD};encrypt=true;trustServerCertificate=true`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});