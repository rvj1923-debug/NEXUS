import { db } from "./db";

export interface AuditLogParams {
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown> | string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const changesString =
      typeof params.changes === "object" && params.changes !== null
        ? JSON.stringify(params.changes)
        : (params.changes as string | undefined);

    await db.auditLog.create({
      data: {
        userId: params.userId,
        userEmail: params.userEmail,
        userRole: params.userRole,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        changes: changesString,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    // Avoid crashing primary flows if audit write encounters transient issues, but log warning
    console.error("[AuditLog Error] Failed to write audit record:", error);
  }
}
