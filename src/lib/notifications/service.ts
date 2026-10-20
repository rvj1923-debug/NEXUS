import { db } from "@/lib/db";
import { createNotification as createNotificationCore } from "./core.mjs";

export interface CreateNotificationParams {
  recipientUserId?: string | null;
  recipientRoleCode?: string | null;
  title: string;
  message: string;
  type?: "INFO" | "WARNING" | "ALERT" | "URGENT";
  severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  linkUrl?: string | null;
  employeeId?: string | null;
  phoneAssetId?: string | null;
  overdueCaseId?: string | null;
}

export async function createNotification(params: CreateNotificationParams) {
  return createNotificationCore(params, db);
}

export async function getUserNotifications(
  userId?: string | null,
  roleCode?: string | null,
  limit = 30,
  unreadOnly = false
) {
  const where: any = {};

  if (unreadOnly) {
    where.isRead = false;
  }

  // Filter for notifications addressed to this user or this role or broadcast (SYSTEM_ADMIN sees all)
  if (roleCode !== "SYSTEM_ADMIN") {
    const orConditions: any[] = [];
    if (userId) {
      orConditions.push({ recipientUserId: userId });
    }
    if (roleCode) {
      orConditions.push({ recipientRoleCode: roleCode });
    }
    orConditions.push({ recipientUserId: null, recipientRoleCode: null }); // Broadcast
    where.OR = orConditions;
  }

  return db.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      phoneAsset: { select: { assetTag: true, brand: true, model: true } },
      overdueCase: { select: { caseNumber: true, status: true, minutesOverdue: true } },
    },
  });
}

export async function getUnreadNotificationCount(
  userId?: string | null,
  roleCode?: string | null
): Promise<number> {
  const where: any = { isRead: false };
  if (roleCode !== "SYSTEM_ADMIN") {
    const orConditions: any[] = [];
    if (userId) {
      orConditions.push({ recipientUserId: userId });
    }
    if (roleCode) {
      orConditions.push({ recipientRoleCode: roleCode });
    }
    orConditions.push({ recipientUserId: null, recipientRoleCode: null });
    where.OR = orConditions;
  }

  return db.notification.count({ where });
}

export async function markNotificationAsRead(id: string) {
  return db.notification.update({
    where: { id },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

export async function markAllNotificationsAsRead(userId?: string | null, roleCode?: string | null) {
  const orConditions: any[] = [];
  if (userId) orConditions.push({ recipientUserId: userId });
  if (roleCode) orConditions.push({ recipientRoleCode: roleCode });
  orConditions.push({ recipientUserId: null, recipientRoleCode: null });

  return db.notification.updateMany({
    where: {
      isRead: false,
      OR: orConditions,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}
