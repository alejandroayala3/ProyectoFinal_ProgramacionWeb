BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[sucursales] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nombre] VARCHAR(100) NOT NULL,
    [activo] BIT NOT NULL CONSTRAINT [sucursales_activo_df] DEFAULT 1,
    CONSTRAINT [sucursales_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [sucursales_nombre_key] UNIQUE NONCLUSTERED ([nombre])
);

-- CreateTable
CREATE TABLE [dbo].[roles] (
    [id] INT NOT NULL IDENTITY(1,1),
    [codigo] VARCHAR(30) NOT NULL,
    [nombre] VARCHAR(80) NOT NULL,
    CONSTRAINT [roles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [roles_codigo_key] UNIQUE NONCLUSTERED ([codigo])
);

-- CreateTable
CREATE TABLE [dbo].[usuarios] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nombre_completo] VARCHAR(150) NOT NULL,
    [correo] VARCHAR(150) NOT NULL,
    [password_hash] VARCHAR(100) NOT NULL,
    [activo] BIT NOT NULL CONSTRAINT [usuarios_activo_df] DEFAULT 1,
    [rol_id] INT NOT NULL,
    [sucursal_id] INT,
    [creado_en] DATETIME2 NOT NULL CONSTRAINT [usuarios_creado_en_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [usuarios_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [usuarios_correo_key] UNIQUE NONCLUSTERED ([correo])
);

-- AddForeignKey
ALTER TABLE [dbo].[usuarios] ADD CONSTRAINT [usuarios_rol_id_fkey] FOREIGN KEY ([rol_id]) REFERENCES [dbo].[roles]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[usuarios] ADD CONSTRAINT [usuarios_sucursal_id_fkey] FOREIGN KEY ([sucursal_id]) REFERENCES [dbo].[sucursales]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
