BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[empleados] (
    [id] INT NOT NULL IDENTITY(1,1),
    [codigo] VARCHAR(30) NOT NULL,
    [nombre_completo] NVARCHAR(150) NOT NULL,
    [sucursal_id] INT NOT NULL,
    [usuario_id] INT,
    [salario_mensual] DECIMAL(12,2) NOT NULL,
    [fecha_ingreso] DATE NOT NULL,
    [fecha_salida] DATE,
    [activo] BIT NOT NULL CONSTRAINT [empleados_activo_df] DEFAULT 1,
    CONSTRAINT [empleados_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [empleados_codigo_key] UNIQUE NONCLUSTERED ([codigo])
);

-- CreateTable
CREATE TABLE [dbo].[planillas] (
    [id] INT NOT NULL IDENTITY(1,1),
    [periodo_inicio] DATE NOT NULL,
    [periodo_fin] DATE NOT NULL,
    [creado_en] DATETIME2 NOT NULL CONSTRAINT [planillas_creado_en_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [planillas_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [planillas_periodo_inicio_periodo_fin_key] UNIQUE NONCLUSTERED ([periodo_inicio],[periodo_fin])
);

-- CreateTable
CREATE TABLE [dbo].[detalles_planilla] (
    [planilla_id] INT NOT NULL,
    [empleado_id] INT NOT NULL,
    [salario_periodo] DECIMAL(12,2) NOT NULL,
    [isss] DECIMAL(12,2) NOT NULL,
    [afp] DECIMAL(12,2) NOT NULL,
    [renta] DECIMAL(12,2) NOT NULL,
    [neto] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [detalles_planilla_pkey] PRIMARY KEY CLUSTERED ([planilla_id],[empleado_id])
);

-- AddForeignKey
ALTER TABLE [dbo].[empleados] ADD CONSTRAINT [empleados_sucursal_id_fkey] FOREIGN KEY ([sucursal_id]) REFERENCES [dbo].[sucursales]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[empleados] ADD CONSTRAINT [empleados_usuario_id_fkey] FOREIGN KEY ([usuario_id]) REFERENCES [dbo].[usuarios]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[detalles_planilla] ADD CONSTRAINT [detalles_planilla_planilla_id_fkey] FOREIGN KEY ([planilla_id]) REFERENCES [dbo].[planillas]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[detalles_planilla] ADD CONSTRAINT [detalles_planilla_empleado_id_fkey] FOREIGN KEY ([empleado_id]) REFERENCES [dbo].[empleados]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Reglas que el esquema Prisma no representa.
ALTER TABLE [dbo].[empleados] ADD CONSTRAINT [empleados_salario_fechas_chk] CHECK (
    [salario_mensual] > 0 AND ([fecha_salida] IS NULL OR [fecha_salida] >= [fecha_ingreso])
);

ALTER TABLE [dbo].[planillas] ADD CONSTRAINT [planillas_periodo_quincenal_chk] CHECK (
    (DAY([periodo_inicio]) = 1 AND [periodo_fin] = DATEADD(DAY, 14, [periodo_inicio]))
    OR (DAY([periodo_inicio]) = 16 AND [periodo_fin] = EOMONTH([periodo_inicio]))
);

ALTER TABLE [dbo].[detalles_planilla] ADD CONSTRAINT [detalles_planilla_importes_chk] CHECK (
    [salario_periodo] > 0 AND [isss] >= 0 AND [afp] >= 0 AND [renta] >= 0 AND [neto] >= 0
    AND [neto] = [salario_periodo] - [isss] - [afp] - [renta]
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
