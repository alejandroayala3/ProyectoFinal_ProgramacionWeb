BEGIN TRY
    BEGIN TRAN;

    -- No asignar cargos por defecto a empleados que no sean el de demostración.
    IF EXISTS (
        SELECT 1 FROM [dbo].[empleados] WITH (TABLOCKX, HOLDLOCK)
        WHERE [codigo] <> 'EMP-DEMO-001'
    )
        THROW 50001, 'Hay empleados que requieren asignación de cargo antes de aplicar esta migración.', 1;

    ALTER TABLE [dbo].[empleados] ADD [cargo] VARCHAR(7) NULL;

    -- Compilar las referencias a cargo después de crear la columna.
    EXEC sys.sp_executesql N'
        UPDATE [dbo].[empleados] SET [cargo] = ''barista'' WHERE [codigo] = ''EMP-DEMO-001'';

        ALTER TABLE [dbo].[empleados] ALTER COLUMN [cargo] VARCHAR(7) NOT NULL;
        ALTER TABLE [dbo].[empleados] ADD CONSTRAINT [empleados_cargo_chk] CHECK (
            [cargo] COLLATE Latin1_General_100_BIN2 IN (''barista'', ''cajero'', ''gerente'')
            AND DATALENGTH([cargo]) = LEN([cargo])
        );
    ';

    COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
