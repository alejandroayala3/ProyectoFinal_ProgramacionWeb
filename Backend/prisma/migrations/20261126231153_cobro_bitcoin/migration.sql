BEGIN TRY
    BEGIN TRAN;

    ALTER TABLE [dbo].[cobros_venta] ADD [referencia_externa] NVARCHAR(60) NULL;
    ALTER TABLE [dbo].[turnos_caja] ADD [total_bitcoin] DECIMAL(12,2) NULL;

    -- Los turnos cerrados antes de esta migración no admitían cobros bitcoin.
    EXEC sys.sp_executesql N'
        UPDATE [dbo].[turnos_caja] SET [total_bitcoin] = 0 WHERE [fecha_cierre] IS NOT NULL;
        ALTER TABLE [dbo].[turnos_caja] ADD CONSTRAINT [turnos_caja_cierre_bitcoin_ck] CHECK (
            ([fecha_cierre] IS NULL AND [total_bitcoin] IS NULL)
            OR ([fecha_cierre] IS NOT NULL AND [total_bitcoin] IS NOT NULL AND [total_bitcoin] >= 0)
        );
    ';

    ALTER TABLE [dbo].[cobros_venta] DROP CONSTRAINT [cobros_venta_metodo_monto_ck];
    ALTER TABLE [dbo].[cobros_venta] ADD CONSTRAINT [cobros_venta_metodo_monto_ck]
        CHECK ([metodo] IN ('efectivo', 'tarjeta', 'digital', 'bitcoin') AND [monto] > 0);

    COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
