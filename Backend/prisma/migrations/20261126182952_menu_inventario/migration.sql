BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[categorias] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nombre] NVARCHAR(100) NOT NULL,
    [activo] BIT NOT NULL CONSTRAINT [categorias_activo_df] DEFAULT 1,
    CONSTRAINT [categorias_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [categorias_nombre_key] UNIQUE NONCLUSTERED ([nombre])
);

-- CreateTable
CREATE TABLE [dbo].[productos] (
    [id] INT NOT NULL IDENTITY(1,1),
    [codigo] NVARCHAR(30) NOT NULL,
    [nombre] NVARCHAR(150) NOT NULL,
    [descripcion] NVARCHAR(500),
    [categoria_id] INT NOT NULL,
    [tipo] VARCHAR(10) NOT NULL,
    [precio_venta] DECIMAL(12,2) NOT NULL,
    [insumo_reventa_id] INT,
    [activo] BIT NOT NULL CONSTRAINT [productos_activo_df] DEFAULT 1,
    CONSTRAINT [productos_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [productos_codigo_key] UNIQUE NONCLUSTERED ([codigo]),
    CONSTRAINT [productos_id_tipo_key] UNIQUE NONCLUSTERED ([id],[tipo])
);

-- CreateTable
CREATE TABLE [dbo].[insumos] (
    [id] INT NOT NULL IDENTITY(1,1),
    [codigo] NVARCHAR(30) NOT NULL,
    [nombre] NVARCHAR(120) NOT NULL,
    [unidad_base] VARCHAR(6) NOT NULL,
    [activo] BIT NOT NULL CONSTRAINT [insumos_activo_df] DEFAULT 1,
    CONSTRAINT [insumos_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [insumos_codigo_key] UNIQUE NONCLUSTERED ([codigo])
);

-- CreateTable
CREATE TABLE [dbo].[recetas] (
    [producto_id] INT NOT NULL,
    [tipo_producto] VARCHAR(10) NOT NULL CONSTRAINT [recetas_tipo_producto_df] DEFAULT 'elaborado',
    [insumo_id] INT NOT NULL,
    [cantidad] DECIMAL(18,3) NOT NULL,
    CONSTRAINT [recetas_pkey] PRIMARY KEY CLUSTERED ([producto_id],[insumo_id])
);

-- CreateTable
CREATE TABLE [dbo].[existencias_sucursal] (
    [sucursal_id] INT NOT NULL,
    [insumo_id] INT NOT NULL,
    [cantidad_actual] DECIMAL(18,3) NOT NULL CONSTRAINT [existencias_sucursal_cantidad_actual_df] DEFAULT 0,
    [cantidad_minima] DECIMAL(18,3) NOT NULL CONSTRAINT [existencias_sucursal_cantidad_minima_df] DEFAULT 0,
    CONSTRAINT [existencias_sucursal_pkey] PRIMARY KEY CLUSTERED ([sucursal_id],[insumo_id])
);

-- CreateTable
CREATE TABLE [dbo].[movimientos_inventario] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [sucursal_id] INT NOT NULL,
    [insumo_id] INT NOT NULL,
    [tipo] VARCHAR(10) NOT NULL,
    [cantidad_cambio] DECIMAL(18,3) NOT NULL,
    [motivo] NVARCHAR(150) NOT NULL,
    [fecha] DATETIME2 NOT NULL CONSTRAINT [movimientos_inventario_fecha_df] DEFAULT CURRENT_TIMESTAMP,
    [costo_unitario_compra] DECIMAL(18,6),
    CONSTRAINT [movimientos_inventario_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [movimientos_inventario_sucursal_id_insumo_id_fecha_idx] ON [dbo].[movimientos_inventario]([sucursal_id], [insumo_id], [fecha]);

-- AddForeignKey
ALTER TABLE [dbo].[productos] ADD CONSTRAINT [productos_categoria_id_fkey] FOREIGN KEY ([categoria_id]) REFERENCES [dbo].[categorias]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[productos] ADD CONSTRAINT [productos_insumo_reventa_id_fkey] FOREIGN KEY ([insumo_reventa_id]) REFERENCES [dbo].[insumos]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[recetas] ADD CONSTRAINT [recetas_producto_id_tipo_producto_fkey] FOREIGN KEY ([producto_id], [tipo_producto]) REFERENCES [dbo].[productos]([id],[tipo]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[recetas] ADD CONSTRAINT [recetas_insumo_id_fkey] FOREIGN KEY ([insumo_id]) REFERENCES [dbo].[insumos]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[existencias_sucursal] ADD CONSTRAINT [existencias_sucursal_sucursal_id_fkey] FOREIGN KEY ([sucursal_id]) REFERENCES [dbo].[sucursales]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[existencias_sucursal] ADD CONSTRAINT [existencias_sucursal_insumo_id_fkey] FOREIGN KEY ([insumo_id]) REFERENCES [dbo].[insumos]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[movimientos_inventario] ADD CONSTRAINT [movimientos_inventario_sucursal_id_insumo_id_fkey] FOREIGN KEY ([sucursal_id], [insumo_id]) REFERENCES [dbo].[existencias_sucursal]([sucursal_id],[insumo_id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Reglas que Prisma Schema no representa como restricciones CHECK.
ALTER TABLE [dbo].[productos] ADD
    CONSTRAINT [productos_precio_venta_ck]
        CHECK ([precio_venta] >= 0),
    CONSTRAINT [productos_tipo_reventa_ck]
        CHECK (
            ([tipo] = 'elaborado' AND [insumo_reventa_id] IS NULL)
            OR ([tipo] = 'reventa' AND [insumo_reventa_id] IS NOT NULL)
        );

ALTER TABLE [dbo].[insumos] ADD
    CONSTRAINT [insumos_unidad_base_ck]
        CHECK ([unidad_base] IN ('g', 'ml', 'unidad'));

-- La clave externa compuesta exige que el producto también sea elaborado.
ALTER TABLE [dbo].[recetas] ADD
    CONSTRAINT [recetas_tipo_producto_ck]
        CHECK ([tipo_producto] = 'elaborado'),
    CONSTRAINT [recetas_cantidad_ck]
        CHECK ([cantidad] > 0);

ALTER TABLE [dbo].[existencias_sucursal] ADD
    CONSTRAINT [existencias_sucursal_cantidades_ck]
        CHECK ([cantidad_actual] >= 0 AND [cantidad_minima] >= 0);

ALTER TABLE [dbo].[movimientos_inventario] ADD
    CONSTRAINT [movimientos_inventario_tipo_cantidad_ck]
        CHECK (
            ([tipo] = 'entrada' AND [cantidad_cambio] > 0)
            OR ([tipo] = 'salida' AND [cantidad_cambio] < 0)
            OR ([tipo] = 'ajuste' AND [cantidad_cambio] <> 0)
        ),
    CONSTRAINT [movimientos_inventario_motivo_ck]
        CHECK (LEN(LTRIM(RTRIM([motivo]))) > 0),
    CONSTRAINT [movimientos_inventario_costo_compra_ck]
        CHECK ([costo_unitario_compra] IS NULL OR [costo_unitario_compra] >= 0);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
