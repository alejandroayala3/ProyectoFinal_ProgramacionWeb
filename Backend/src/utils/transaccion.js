import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';

// Las operaciones que mueven dinero o inventario corren en una transacción
// Serializable: si algo falla a mitad, SQL Server revierte todo.
export function ejecutarTransaccion(operacion) {
    return prisma.$transaction(operacion, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
    });
}
