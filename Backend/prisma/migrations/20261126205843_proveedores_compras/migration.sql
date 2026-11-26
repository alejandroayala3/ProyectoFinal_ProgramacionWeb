BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[movimientos_inventario] ADD [detalle_compra_id] INT;

-- CreateTable
CREATE TABLE [dbo].[proveedores] (
    [id] INT NOT NULL IDENTITY(1,1),
    [codigo] NVARCHAR(30) NOT NULL,
    [nombre] NVARCHAR(150) NOT NULL,
    [activo] BIT NOT NULL CONSTRAINT [proveedores_activo_df] DEFAULT 1,
    CONSTRAINT [proveedores_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [proveedores_codigo_key] UNIQUE NONCLUSTERED ([codigo])
);

-- CreateTable
CREATE TABLE [dbo].[compras] (
    [id] INT NOT NULL IDENTITY(1,1),
    [proveedor_id] INT NOT NULL,
    [sucursal_id] INT NOT NULL,
    [numero_factura] NVARCHAR(50) NOT NULL,
    [fecha] DATETIME2 NOT NULL CONSTRAINT [compras_fecha_df] DEFAULT CURRENT_TIMESTAMP,
    [subtotal] DECIMAL(12,2) NOT NULL,
    [iva] DECIMAL(12,2) NOT NULL,
    [total] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [compras_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [compras_proveedor_id_numero_factura_key] UNIQUE NONCLUSTERED ([proveedor_id],[numero_factura])
);

-- CreateTable
CREATE TABLE [dbo].[detalles_compra] (
    [id] INT NOT NULL IDENTITY(1,1),
    [compra_id] INT NOT NULL,
    [insumo_id] INT NOT NULL,
    [cantidad] DECIMAL(18,3) NOT NULL,
    [costo_unitario] DECIMAL(18,6) NOT NULL,
    CONSTRAINT [detalles_compra_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [detalles_compra_compra_id_insumo_id_key] UNIQUE NONCLUSTERED ([compra_id],[insumo_id]),
    CONSTRAINT [detalles_compra_id_insumo_id_key] UNIQUE NONCLUSTERED ([id],[insumo_id])
);

-- CreateTable
CREATE TABLE [dbo].[pagos_compra] (
    [id] INT NOT NULL IDENTITY(1,1),
    [compra_id] INT NOT NULL,
    [referencia] NVARCHAR(60) NOT NULL,
    [metodo] NVARCHAR(30) NOT NULL,
    [monto] DECIMAL(12,2) NOT NULL,
    [fecha] DATETIME2 NOT NULL CONSTRAINT [pagos_compra_fecha_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [pagos_compra_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [pagos_compra_compra_id_referencia_key] UNIQUE NONCLUSTERED ([compra_id],[referencia])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [compras_sucursal_id_fecha_idx] ON [dbo].[compras]([sucursal_id], [fecha]);

-- AddForeignKey
ALTER TABLE [dbo].[compras] ADD CONSTRAINT [compras_proveedor_id_fkey] FOREIGN KEY ([proveedor_id]) REFERENCES [dbo].[proveedores]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[compras] ADD CONSTRAINT [compras_sucursal_id_fkey] FOREIGN KEY ([sucursal_id]) REFERENCES [dbo].[sucursales]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[detalles_compra] ADD CONSTRAINT [detalles_compra_compra_id_fkey] FOREIGN KEY ([compra_id]) REFERENCES [dbo].[compras]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[detalles_compra] ADD CONSTRAINT [detalles_compra_insumo_id_fkey] FOREIGN KEY ([insumo_id]) REFERENCES [dbo].[insumos]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[pagos_compra] ADD CONSTRAINT [pagos_compra_compra_id_fkey] FOREIGN KEY ([compra_id]) REFERENCES [dbo].[compras]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Importes de compra sin IVA en el subtotal y en el costo por unidad base.
ALTER TABLE [dbo].[compras] ADD CONSTRAINT [compras_importes_ck]
    CHECK ([subtotal] >= 0 AND [iva] >= 0 AND [total] = [subtotal] + [iva]);

ALTER TABLE [dbo].[detalles_compra] ADD CONSTRAINT [detalles_compra_cantidad_costo_ck]
    CHECK ([cantidad] > 0 AND [costo_unitario] >= 0);

ALTER TABLE [dbo].[pagos_compra] ADD CONSTRAINT [pagos_compra_monto_ck]
    CHECK ([monto] > 0);

-- Un detalle tiene como máximo una entrada. Las entradas anteriores conservan NULL.
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
-- Compilar aparte para que SQL Server vea la columna agregada arriba.
EXEC sys.sp_executesql N'
ALTER TABLE [dbo].[movimientos_inventario] ADD CONSTRAINT [movimientos_inventario_detalle_compra_id_insumo_id_fkey] FOREIGN KEY ([detalle_compra_id], [insumo_id]) REFERENCES [dbo].[detalles_compra]([id],[insumo_id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[movimientos_inventario] ADD CONSTRAINT [movimientos_inventario_detalle_compra_entrada_ck]
    CHECK ([detalle_compra_id] IS NULL OR [tipo] = ''entrada'');

CREATE UNIQUE NONCLUSTERED INDEX [movimientos_inventario_detalle_compra_unico]
    ON [dbo].[movimientos_inventario]([detalle_compra_id])
    WHERE [detalle_compra_id] IS NOT NULL;
';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
