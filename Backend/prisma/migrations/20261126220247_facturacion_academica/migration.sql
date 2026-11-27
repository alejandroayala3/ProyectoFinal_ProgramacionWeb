BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[clientes] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nombre] NVARCHAR(150) NOT NULL,
    [razon_social] NVARCHAR(150),
    [nit] NVARCHAR(25),
    [nrc] NVARCHAR(25),
    [activo] BIT NOT NULL CONSTRAINT [clientes_activo_df] DEFAULT 1,
    CONSTRAINT [clientes_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[documentos_venta] (
    [id] INT NOT NULL IDENTITY(1,1),
    [venta_id] INT NOT NULL,
    [sucursal_id] INT NOT NULL,
    [cliente_id] INT,
    [tipo_documento] VARCHAR(16) NOT NULL,
    [correlativo] INT NOT NULL,
    [fecha] DATETIME2 NOT NULL CONSTRAINT [documentos_venta_fecha_df] DEFAULT CURRENT_TIMESTAMP,
    [nombre_cliente] NVARCHAR(150),
    [razon_social] NVARCHAR(150),
    [nit] NVARCHAR(25),
    [nrc] NVARCHAR(25),
    [subtotal] DECIMAL(12,2) NOT NULL,
    [iva] DECIMAL(12,2) NOT NULL,
    [total] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [documentos_venta_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [documentos_venta_venta_id_key] UNIQUE NONCLUSTERED ([venta_id]),
    CONSTRAINT [documentos_venta_sucursal_id_tipo_documento_correlativo_key] UNIQUE NONCLUSTERED ([sucursal_id],[tipo_documento],[correlativo])
);

-- AddForeignKey
ALTER TABLE [dbo].[documentos_venta] ADD CONSTRAINT [documentos_venta_venta_id_sucursal_id_fkey] FOREIGN KEY ([venta_id], [sucursal_id]) REFERENCES [dbo].[ventas]([id],[sucursal_id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[documentos_venta] ADD CONSTRAINT [documentos_venta_cliente_id_fkey] FOREIGN KEY ([cliente_id]) REFERENCES [dbo].[clientes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[documentos_venta] ADD
    CONSTRAINT [documentos_venta_tipo_correlativo_ck]
        CHECK ([tipo_documento] IN ('consumidor_final', 'ccf') AND [correlativo] > 0),
    CONSTRAINT [documentos_venta_importes_ck]
        CHECK ([subtotal] >= 0 AND [iva] >= 0 AND [total] = [subtotal] + [iva]),
    CONSTRAINT [documentos_venta_cliente_ccf_ck]
        CHECK ([tipo_documento] = 'consumidor_final' OR
            ([cliente_id] IS NOT NULL AND
             [razon_social] IS NOT NULL AND LEN(LTRIM(RTRIM([razon_social]))) > 0 AND
             [nit] IS NOT NULL AND LEN(LTRIM(RTRIM([nit]))) > 0 AND
             [nrc] IS NOT NULL AND LEN(LTRIM(RTRIM([nrc]))) > 0));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
