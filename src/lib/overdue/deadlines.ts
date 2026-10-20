import { db } from "@/lib/db";
import { CustodyError } from "@/lib/custody/engine";

export interface ExtensionParams {
  transactionId: string;
  extensionMinutes: number;
  reason: string;
  approvedByUserId?: string | null;
  requestedBy?: string | null;
}

export interface ExemptionParams {
  transactionId: string;
  reason: string;
  approvedByUserId?: string | null;
}

/**
 * Grants an approved return deadline extension with historical audit record.
 */
export async function requestDeadlineExtension(params: ExtensionParams) {
  const { transactionId, extensionMinutes, reason, approvedByUserId, requestedBy } = params;

  if (extensionMinutes <= 0) {
    throw new CustodyError("Extension duration must be greater than zero minutes.", 400);
  }
  if (!reason || reason.trim().length < 5) {
    throw new CustodyError("Mandatory extension justification (at least 5 characters) is required.", 400);
  }

  const deadline = await db.returnDeadline.findUnique({
    where: { custodyTransactionId: transactionId },
    include: { custodyTransaction: true, phoneAsset: true, employee: true },
  });

  if (!deadline) {
    throw new CustodyError("Return deadline record not found for this transaction.", 404);
  }

  if (deadline.status === "RETURNED_ON_TIME" || deadline.status === "RETURNED_LATE") {
    throw new CustodyError("Cannot extend deadline for a device that has already been returned.", 400);
  }

  const previousDeadline = deadline.extendedReturnAt || deadline.expectedReturnAt;
  const newDeadline = new Date(previousDeadline.getTime() + extensionMinutes * 60 * 1000);

  const result = await db.$transaction(async (tx) => {
    // 1. Create DeadlineExtension audit record
    const extension = await tx.deadlineExtension.create({
      data: {
        returnDeadlineId: deadline.id,
        previousDeadline,
        newDeadline,
        extensionMinutes,
        reason: reason.trim(),
        approvedByUserId: approvedByUserId || null,
        requestedBy: requestedBy || null,
      },
    });

    // 2. Update ReturnDeadline
    const updatedDeadline = await tx.returnDeadline.update({
      where: { id: deadline.id },
      data: {
        extendedReturnAt: newDeadline,
        status: newDeadline.getTime() > Date.now() ? "PENDING" : deadline.status,
      },
    });

    // 3. Update CustodyTransaction
    const updatedTx = await tx.custodyTransaction.update({
      where: { id: transactionId },
      data: {
        returnDeadlineAt: newDeadline,
        status: newDeadline.getTime() > Date.now() ? "ISSUED" : undefined,
        overdueMinutes: newDeadline.getTime() > Date.now() ? 0 : undefined,
      },
    });

    // 4. Log Immutable Custody Event
    await tx.custodyEvent.create({
      data: {
        transactionId,
        phoneAssetId: deadline.phoneAssetId,
        employeeId: deadline.employeeId,
        eventType: "EXTENDED",
        actorUserId: approvedByUserId || null,
        details: `Return deadline extended by ${extensionMinutes}m until ${newDeadline.toISOString()}. Reason: ${reason}`,
      },
    });

    // 5. If there was an open overdue case and new deadline is in the future, resolve or de-escalate
    if (newDeadline.getTime() > Date.now()) {
      await tx.overdueCase.updateMany({
        where: { custodyTransactionId: transactionId, status: "OPEN" },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolutionType: "EXCUSED",
          resolutionNotes: `Approved extension by ${extensionMinutes}m: ${reason}`,
        },
      });
    }

    return { extension, updatedDeadline, updatedTx };
  });

  return {
    success: true,
    message: `Deadline extended by ${extensionMinutes} minutes.`,
    newDeadline,
    extension: result.extension,
  };
}

/**
 * Grants temporary exemption from automatic overdue monitoring
 */
export async function grantTemporaryExemption(params: ExemptionParams) {
  const { transactionId, reason, approvedByUserId } = params;

  if (!reason || reason.trim().length < 5) {
    throw new CustodyError("Mandatory exemption reason is required.", 400);
  }

  const deadline = await db.returnDeadline.findUnique({
    where: { custodyTransactionId: transactionId },
  });

  if (!deadline) {
    throw new CustodyError("Return deadline record not found.", 404);
  }

  const updated = await db.returnDeadline.update({
    where: { id: deadline.id },
    data: {
      isExempt: true,
      exemptionReason: reason.trim(),
    },
  });

  await db.custodyEvent.create({
    data: {
      transactionId,
      phoneAssetId: deadline.phoneAssetId,
      employeeId: deadline.employeeId,
      eventType: "EXEMPTION_GRANTED",
      actorUserId: approvedByUserId || null,
      details: `Temporary overdue exemption granted: ${reason}`,
    },
  });

  return {
    success: true,
    message: "Temporary exemption granted.",
    deadline: updated,
  };
}
