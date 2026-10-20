import { PrismaClient } from "@prisma/client";

let fallbackDb = null;

function getDbClient(providedDb) {
  if (providedDb) return providedDb;
  if (!fallbackDb) {
    fallbackDb = new PrismaClient();
  }
  return fallbackDb;
}

/**
 * @param {any} params
 * @param {any} [dbClient]
 */
export async function createNotification(params, dbClient = undefined) {
  const db = getDbClient(dbClient);
  const {
    recipientUserId,
    recipientRoleCode,
    title,
    message,
    type = "INFO",
    severity = "INFO",
    linkUrl,
    employeeId,
    phoneAssetId,
    overdueCaseId,
  } = params;

  return db.notification.create({
    data: {
      recipientUserId: recipientUserId || null,
      recipientRoleCode: recipientRoleCode || null,
      title,
      message,
      type,
      severity,
      linkUrl: linkUrl || null,
      employeeId: employeeId || null,
      phoneAssetId: phoneAssetId || null,
      overdueCaseId: overdueCaseId || null,
      isRead: false,
    },
  });
}
