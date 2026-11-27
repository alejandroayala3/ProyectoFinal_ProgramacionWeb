BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[movimientos_inventario] ADD [detalle_venta_id] INT;

-- CreateTable
CREATE TABLE [dbo].[ventas] (
    [id] INT NOT NULL IDENTITY(1,1),
    [referencia] NVARCHAR(50) NOT NULL,
    [sucursal_id] INT NOT NULL,
    [usuario_id] INT NOT NULL,
    [fecha] DATETIME2 NOT NULL CONSTRAINT [ventas_fecha_df] DEFAULT CURRENT_TIMESTAMP,
    [subtotal] DECIMAL(12,2) NOT NULL,
    [iva] DECIMAL(12,2) NOT NULL,
    [total] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [ventas_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ventas_referencia_key] UNIQUE NONCLUSTERED ([referencia])
);

-- CreateTable
CREATE TABLE [dbo].[detalles_venta] (
    [id] INT NOT NULL IDENTITY(1,1),
    [venta_id] INT NOT NULL,
    [producto_id] INT NOT NULL,
    [cantidad] INT NOT NULL,
    [precio_unitario] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [detalles_venta_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [detalles_venta_venta_id_producto_id_key] UNIQUE NONCLUSTERED ([venta_id],[producto_id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ventas_sucursal_id_fecha_idx] ON [dbo].[ventas]([sucursal_id], [fecha]);

-- AddForeignKey
ALTER TABLE [dbo].[ventas] ADD CONSTRAINT [ventas_sucursal_id_fkey] FOREIGN KEY ([sucursal_id]) REFERENCES [dbo].[sucursales]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ventas] ADD CONSTRAINT [ventas_usuario_id_fkey] FOREIGN KEY ([usuario_id]) REFERENCES [dbo].[usuarios]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[detalles_venta] ADD CONSTRAINT [detalles_venta_venta_id_fkey] FOREIGN KEY ([venta_id]) REFERENCES [dbo].[ventas]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[detalles_venta] ADD CONSTRAINT [detalles_venta_producto_id_fkey] FOREIGN KEY ([producto_id]) REFERENCES [dbo].[productos]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[ventas] ADD CONSTRAINT [ventas_importes_ck]
    CHECK ([subtotal] >= 0 AND [iva] >= 0 AND [total] = [subtotal] + [iva]);

ALTER TABLE [dbo].[detalles_venta] ADD CONSTRAINT [detalles_venta_cantidad_precio_ck]
    CHECK ([cantidad] > 0 AND [precio_unitario] >= 0);

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

-- Compilar después de que exista la nueva columna en movimientos.
EXEC sys.sp_executesql N'
ALTER TABLE [dbo].[movimientos_inventario] ADD CONSTRAINT [movimientos_inventario_detalle_venta_id_fkey] FOREIGN KEY ([detalle_venta_id]) REFERENCES [dbo].[detalles_venta]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[movimientos_inventario] ADD CONSTRAINT [movimientos_inventario_detalle_venta_salida_ck]
    CHECK ([detalle_venta_id] IS NULL OR ([tipo] = ''salida'' AND [detalle_compra_id] IS NULL));

CREATE UNIQUE NONCLUSTERED INDEX [movimientos_inventario_venta_detalle_insumo_unico]
    ON [dbo].[movimientos_inventario]([detalle_venta_id], [insumo_id])
    WHERE [detalle_venta_id] IS NOT NULL;
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
