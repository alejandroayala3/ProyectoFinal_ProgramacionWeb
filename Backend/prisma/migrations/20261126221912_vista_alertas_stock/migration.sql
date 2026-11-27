CREATE VIEW [dbo].[v_reporte_alertas_stock]
AS
    SELECT
        [s].[id] AS [sucursal_id],
        [s].[nombre] AS [sucursal],
        [i].[id] AS [insumo_id],
        [i].[nombre] AS [insumo],
        [i].[unidad_base] AS [unidad],
        [e].[cantidad_actual],
        [e].[cantidad_minima]
    FROM [dbo].[existencias_sucursal] AS [e]
    INNER JOIN [dbo].[sucursales] AS [s] ON [s].[id] = [e].[sucursal_id]
    INNER JOIN [dbo].[insumos] AS [i] ON [i].[id] = [e].[insumo_id]
    WHERE [s].[activo] = 1
      AND [i].[activo] = 1
      AND [e].[cantidad_actual] <= [e].[cantidad_minima];
