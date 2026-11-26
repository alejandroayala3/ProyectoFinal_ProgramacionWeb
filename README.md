# Restaurante Orígenes SV

## Instalar el backend desde un clon

1. Instala Node.js 24 con npm. En SQL Server, habilita TCP/IP y la autenticación de SQL Server. Usa un usuario que pueda crear objetos en la base que vas a usar.
2. Conéctate desde SQL Server Management Studio al servidor y puerto de tu instancia. Crea una base **vacía** para el proyecto. Por ejemplo, ejecuta `CREATE DATABASE [origenesv_demo];` desde `master`.
3. Desde la raíz del repositorio, entra a `Backend` y crea tu configuración local.

   ```powershell
   cd .\Backend
   Copy-Item .env.example .env
   ```

   En `.env`, pon el host en `DB_HOST`, el puerto TCP de tu instancia en `DB_PORT` (1433 por defecto), el nombre de la base nueva en `DB_NAME` y las credenciales de SQL Server en `DB_USER` y `DB_PASSWORD`. Define tu propio `JWT_SECRET` para arrancar la API. `PORT` es el puerto de la API y `JWT_EXPIRA_EN` controla la duración de la sesión. Mantén tu `.env` fuera de Git.

4. Instala las dependencias y aplica las migraciones versionadas desde `Backend`.

   ```powershell
   npm ci
   npx prisma migrate deploy
   ```

   `npm ci` genera Prisma Client. `migrate deploy` crea la estructura y la vista de alertas.

## Cargar datos de demostración

Antes de la primera carga, define `DEMO_ADMIN_PASSWORD` con una contraseña exclusiva para la cuenta demo `admin@origenes.sv`. Define también las nueve variables `DEMO_<ROL>_<SUCURSAL>_PASSWORD` de `.env.example`. Las cuentas usan el formato `rol.sucursal@origenes.sv`, por ejemplo `gerente.central@origenes.sv` y `barista.santa.elena@origenes.sv`. Usa una base de demostración. Confirma el host, puerto y nombre que configuraste en `.env`; el siguiente ejemplo usa `localhost:1433/origenesv_demo`.

```powershell
npm run db:cargar -- "--confirmar-demo=localhost:1433/origenesv_demo"
```

El comando ejecuta el seed, las sucursales, sus nueve usuarios demo, el catálogo y las recetas, el inventario inicial, la compra, la venta, la caja, la factura y la planilla de prueba. Se detiene en el primer error. Los pasos terminados quedan guardados; después de resolver el error, puedes repetir el comando sin duplicar datos ni volver a aplicar movimientos de stock. Tampoco se cambia la contraseña de una cuenta demo que ya existe.

Para ejecutar un paso individual, pasa la misma confirmación a `npm run seed --` o al script, por ejemplo `node prisma/cargarEntradas.js "--confirmar-demo=localhost:1433/origenesv_demo"`.

Arranca la API con `npm run dev` desde `Backend`. Con el puerto predeterminado, puedes comprobarla en `http://localhost:3000/api/salud`.
