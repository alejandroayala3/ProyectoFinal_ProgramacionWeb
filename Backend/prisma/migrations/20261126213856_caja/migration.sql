BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[turnos_caja] (
    [id] INT NOT NULL IDENTITY(1,1),
    [referencia] NVARCHAR(60) NOT NULL,
    [sucursal_id] INT NOT NULL,
    [usuario_id] INT NOT NULL,
    [fecha_apertura] DATETIME2 NOT NULL CONSTRAINT [turnos_caja_fecha_apertura_df] DEFAULT CURRENT_TIMESTAMP,
    [fecha_cierre] DATETIME2,
    [fondo_inicial] DECIMAL(12,2) NOT NULL,
    [efectivo_esperado] DECIMAL(12,2),
    [efectivo_contado] DECIMAL(12,2),
    [diferencia] DECIMAL(12,2),
    [total_tarjeta] DECIMAL(12,2),
    [total_digital] DECIMAL(12,2),
    CONSTRAINT [turnos_caja_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [turnos_caja_referencia_key] UNIQUE NONCLUSTERED ([referencia]),
    CONSTRAINT [turnos_caja_id_sucursal_id_key] UNIQUE NONCLUSTERED ([id],[sucursal_id])
);

-- CreateTable
CREATE TABLE [dbo].[cobros_venta] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [referencia] NVARCHAR(60) NOT NULL,
    [turno_id] INT NOT NULL,
    [venta_id] INT NOT NULL,
    [sucursal_id] INT NOT NULL,
    [metodo] VARCHAR(10) NOT NULL,
    [monto] DECIMAL(12,2) NOT NULL,
    [fecha] DATETIME2 NOT NULL CONSTRAINT [cobros_venta_fecha_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [cobros_venta_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [cobros_venta_referencia_key] UNIQUE NONCLUSTERED ([referencia])
);

-- CreateTable
CREATE TABLE [dbo].[movimientos_caja] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [referencia] NVARCHAR(60) NOT NULL,
    [turno_id] INT NOT NULL,
    [tipo] VARCHAR(10) NOT NULL,
    [monto] DECIMAL(12,2) NOT NULL,
    [motivo] NVARCHAR(150) NOT NULL,
    [fecha] DATETIME2 NOT NULL CONSTRAINT [movimientos_caja_fecha_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [movimientos_caja_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [movimientos_caja_referencia_key] UNIQUE NONCLUSTERED ([referencia])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [turnos_caja_sucursal_id_fecha_apertura_idx] ON [dbo].[turnos_caja]([sucursal_id], [fecha_apertura]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [cobros_venta_turno_id_metodo_idx] ON [dbo].[cobros_venta]([turno_id], [metodo]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [cobros_venta_venta_id_idx] ON [dbo].[cobros_venta]([venta_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [movimientos_caja_turno_id_tipo_idx] ON [dbo].[movimientos_caja]([turno_id], [tipo]);

-- CreateIndex
ALTER TABLE [dbo].[ventas] ADD CONSTRAINT [ventas_id_sucursal_id_key] UNIQUE NONCLUSTERED ([id], [sucursal_id]);

-- AddForeignKey
ALTER TABLE [dbo].[turnos_caja] ADD CONSTRAINT [turnos_caja_sucursal_id_fkey] FOREIGN KEY ([sucursal_id]) REFERENCES [dbo].[sucursales]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[turnos_caja] ADD CONSTRAINT [turnos_caja_usuario_id_fkey] FOREIGN KEY ([usuario_id]) REFERENCES [dbo].[usuarios]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cobros_venta] ADD CONSTRAINT [cobros_venta_turno_id_sucursal_id_fkey] FOREIGN KEY ([turno_id], [sucursal_id]) REFERENCES [dbo].[turnos_caja]([id],[sucursal_id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cobros_venta] ADD CONSTRAINT [cobros_venta_venta_id_sucursal_id_fkey] FOREIGN KEY ([venta_id], [sucursal_id]) REFERENCES [dbo].[ventas]([id],[sucursal_id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[movimientos_caja] ADD CONSTRAINT [movimientos_caja_turno_id_fkey] FOREIGN KEY ([turno_id]) REFERENCES [dbo].[turnos_caja]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Un turno abierto no tiene importes de cierre; uno cerrado conserva el cuadre.
ALTER TABLE [dbo].[turnos_caja] ADD
    CONSTRAINT [turnos_caja_fondo_ck] CHECK ([fondo_inicial] >= 0),
    CONSTRAINT [turnos_caja_cierre_ck] CHECK (
        ([fecha_cierre] IS NULL AND [efectivo_esperado] IS NULL AND [efectivo_contado] IS NULL
            AND [diferencia] IS NULL AND [total_tarjeta] IS NULL AND [total_digital] IS NULL)
        OR
        ([fecha_cierre] IS NOT NULL AND [fecha_cierre] >= [fecha_apertura]
            AND [efectivo_esperado] IS NOT NULL AND [efectivo_contado] IS NOT NULL AND [efectivo_contado] >= 0
            AND [diferencia] IS NOT NULL AND [diferencia] = [efectivo_contado] - [efectivo_esperado]
            AND [total_tarjeta] IS NOT NULL AND [total_tarjeta] >= 0
            AND [total_digital] IS NOT NULL AND [total_digital] >= 0)
    );

ALTER TABLE [dbo].[cobros_venta] ADD CONSTRAINT [cobros_venta_metodo_monto_ck]
    CHECK ([metodo] IN ('efectivo', 'tarjeta', 'digital') AND [monto] > 0);

ALTER TABLE [dbo].[movimientos_caja] ADD CONSTRAINT [movimientos_caja_tipo_monto_motivo_ck]
    CHECK ([tipo] IN ('entrada', 'salida') AND [monto] > 0 AND LEN(LTRIM(RTRIM([motivo]))) > 0);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
