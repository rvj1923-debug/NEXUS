/**
 * Enterprise Custody Transaction State Machine & Engine
 * High-reliability execution with database locking, idempotency protection,
 * and automatic incident generation for damaged/missing assets.
 */

import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit";
import { computeReturnDeadline, evaluateReturnPunctuality } from "./timezone";

export interface IssuePhoneParams {
  employeeId: string;
  phoneAssetId: string;
  handledByUserId?: string | null;
  nfcCardId?: string | null;
  nfcReaderId?: string | null;
  conditionAtAction?: string;
  accessoriesIssued?: string;
  remarks?: string | null;
  idempotencyKey?: string | null;
  customDeadline?: Date | null;
  isManualOverride?: boolean;
  overrideReason?: string | null;
  verifiedViaNfc?: boolean;
}

export interface SurrenderPhoneParams {
  transactionId?: string | null;
  phoneAssetId?: string | null;
  employeeId?: string | null;
  handledByUserId?: string | null;
  nfcReaderId?: string | null;
  conditionAtAction: "GOOD" | "MINOR_DAMAGE" | "MAJOR_DAMAGE" | "NOT_FUNCTIONAL" | "ACCESSORIES_MISSING";
  accessoriesReturned?: string;
  conditionNotes?: string | null;
  remarks?: string | null;
  photoEvidenceUrl?: string | null;
  idempotencyKey?: string | null;
  isManualOverride?: boolean;
  overrideReason?: string | null;
  surrenderedByRepresentative?: boolean;
  representativeName?: string | null;
  transactionType?: "SURRENDER" | "TIME_OUT";
}

export class CustodyError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 400, code = "CUSTODY_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Executes a phone issuance workflow inside an atomic database transaction
 */
export async function issuePhone(params: IssuePhoneParams) {
  // 1. Idempotency Check
  if (params.idempotencyKey) {
    const existing = await db.custodyTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      include: {
        employee: true,
        phoneAsset: true,
        returnDeadline: true,
      },
    });
    if (existing) {
      return {
        success: true,
        transaction: existing,
        phone: existing.phoneAsset,
        isDuplicate: true,
        message: "Duplicate request acknowledged. Existing issuance returned.",
      };
    }
  }

  // 2. Validate Employee
  const employee = await db.employee.findUnique({
    where: { id: params.employeeId },
    include: {
      shifts: { where: { isActive: true }, take: 1 },
      nfcCards: { where: { status: "ACTIVE" } },
    },
  });

  if (!employee) {
    throw new CustodyError("Employee not found.", 404, "EMPLOYEE_NOT_FOUND");
  }
  if (employee.status !== "ACTIVE") {
    throw new CustodyError(
      `Employee ${employee.firstName} ${employee.lastName} is ${employee.status}. Phone issuance is restricted.`,
      400,
      "EMPLOYEE_INACTIVE"
    );
  }

  // 3. Validate Phone Asset
  const phone = await db.phoneAsset.findUnique({
    where: { id: params.phoneAssetId },
  });

  if (!phone || !phone.isActive) {
    throw new CustodyError("Phone asset not found or deactivated.", 404, "PHONE_NOT_FOUND");
  }

  if (phone.operationalStatus === "DAMAGED" || phone.operationalStatus === "UNDER_MAINTENANCE" || phone.operationalStatus === "LOST") {
    throw new CustodyError(
      `Device ${phone.assetTag} cannot be issued because it is ${phone.operationalStatus}.`,
      400,
      "DEVICE_NOT_OPERATIONAL"
    );
  }

  if (phone.custodyStatus === "ISSUED") {
    throw new CustodyError(
      `Device ${phone.assetTag} is already physically checked out in active custody. Cannot issue concurrently.`,
      409,
      "PHONE_ALREADY_ISSUED"
    );
  }

  // 4. Check if Employee already holds an open custody phone (unless multi-device authorized)
  const openEmployeeTx = await db.custodyTransaction.findFirst({
    where: {
      employeeId: employee.id,
      status: "ISSUED",
      transactionType: "ISSUANCE",
    },
    include: { phoneAsset: true },
  });

  if (openEmployeeTx && !employee.multiCardAuthorized && !params.isManualOverride) {
    throw new CustodyError(
      `Employee ${employee.firstName} ${employee.lastName} already has active phone ${openEmployeeTx.phoneAsset?.assetTag || "in custody"}. Surrender the open device first or apply supervisor override.`,
      409,
      "OPEN_CUSTODY_CONFLICT"
    );
  }

  // 4b. Pool-based phone issuance: Devices are shared pool assets and do not require pre-assignment to employees.

  // 5. Calculate Expected Return Deadline
  const activeShift = employee.shifts[0];
  const returnDeadlineAt = params.customDeadline || computeReturnDeadline(activeShift);

  // 6. Generate Transaction Code
  const txCode = `CTX-ISS-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // 7. Atomic Database Transaction
  const result = await db.$transaction(async (tx) => {
    // Lock and update PhoneAsset custodyStatus
    const updatedPhone = await tx.phoneAsset.update({
      where: { id: phone.id },
      data: {
        custodyStatus: "ISSUED",
        condition: params.conditionAtAction || "GOOD",
      },
    });

    // Create CustodyTransaction
    const transaction = await tx.custodyTransaction.create({
      data: {
        transactionCode: txCode,
        transactionType: "ISSUANCE",
        status: "ISSUED",
        phoneAssetId: phone.id,
        employeeId: employee.id,
        nfcCardId: params.nfcCardId || null,
        nfcReaderId: params.nfcReaderId || null,
        handledByUserId: params.handledByUserId || null,
        timestamp: new Date(),
        returnDeadlineAt,
        conditionAtAction: params.conditionAtAction || "GOOD",
        accessoriesIssued: params.accessoriesIssued || "Phone, Charger, Case",
        remarks: params.remarks || null,
        idempotencyKey: params.idempotencyKey || null,
        isManualOverride: params.isManualOverride || false,
        overrideReason: params.overrideReason || null,
        verifiedViaNfc: params.verifiedViaNfc ?? true,
      },
    });

    // Create ReturnDeadline record
    const deadline = await tx.returnDeadline.create({
      data: {
        custodyTransactionId: transaction.id,
        phoneAssetId: phone.id,
        employeeId: employee.id,
        expectedReturnAt: returnDeadlineAt,
        originalExpectedReturnAt: returnDeadlineAt,
        status: "PENDING",
        gracePeriodMinutes: activeShift?.gracePeriodMinutes ?? 30,
      },
    });

    // Create Immutable Custody Event
    await tx.custodyEvent.create({
      data: {
        transactionId: transaction.id,
        phoneAssetId: phone.id,
        employeeId: employee.id,
        eventType: params.isManualOverride ? "EXCEPTION_OVERRIDE" : "CHECKED_OUT",
        actorUserId: params.handledByUserId || null,
        details: `Issued device ${phone.assetTag} to ${employee.firstName} ${employee.lastName}. Deadline: ${returnDeadlineAt.toISOString()}`,
      },
    });

    // Update reader lastScannedAt if applicable
    if (params.nfcReaderId) {
      await tx.nfcReader.updateMany({
        where: { id: params.nfcReaderId },
        data: { lastScannedAt: new Date(), lastError: null },
      });
    }

    return { transaction, updatedPhone, deadline };
  });

  // 8. Write Audit Log
  await recordAuditLog({
    userId: params.handledByUserId,
    action: "CUSTODY_ISSUANCE",
    entityType: "CUSTODY_TRANSACTION",
    entityId: result.transaction.id,
    changes: {
      transactionCode: txCode,
      employeeCode: employee.employeeCode,
      phoneAssetTag: phone.assetTag,
      returnDeadlineAt: returnDeadlineAt.toISOString(),
      isManualOverride: params.isManualOverride,
    },
  });

  return {
    success: true,
    transaction: result.transaction,
    phone: result.updatedPhone,
    deadline: result.deadline,
    message: `Phone ${phone.assetTag} issued to ${employee.firstName} ${employee.lastName}.`,
  };
}

/**
 * Executes a phone surrender (return) workflow with punctuality calculation
 * and automatic incident generation for damage.
 */
export async function surrenderPhone(params: SurrenderPhoneParams) {
  // 1. Idempotency Check
  if (params.idempotencyKey) {
    const existing = await db.custodyTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      include: { phoneAsset: true, employee: true },
    });
    if (existing && existing.status === "RETURNED") {
      return {
        success: true,
        transaction: existing,
        phone: existing.phoneAsset,
        isDuplicate: true,
        message: "Duplicate return acknowledged. Device was already surrendered.",
      };
    }
  }

  // 2. Identify Open Custody Transaction
  let openTx = null;

  if (params.transactionId) {
    openTx = await db.custodyTransaction.findUnique({
      where: { id: params.transactionId },
      include: {
        phoneAsset: true,
        employee: true,
        returnDeadline: true,
      },
    });
  } else if (params.phoneAssetId) {
    openTx = await db.custodyTransaction.findFirst({
      where: {
        phoneAssetId: params.phoneAssetId,
        status: { in: ["ISSUED", "OVERDUE"] },
      },
      orderBy: { timestamp: "desc" },
      include: {
        phoneAsset: true,
        employee: true,
        returnDeadline: true,
      },
    });
  } else if (params.employeeId) {
    openTx = await db.custodyTransaction.findFirst({
      where: {
        employeeId: params.employeeId,
        status: { in: ["ISSUED", "OVERDUE"] },
      },
      orderBy: { timestamp: "desc" },
      include: {
        phoneAsset: true,
        employee: true,
        returnDeadline: true,
      },
    });
  }

  if (!openTx || (openTx.status !== "ISSUED" && openTx.status !== "OVERDUE")) {
    throw new CustodyError(
      "No open custody transaction found for this device or employee. The phone may already have been returned.",
      404,
      "NO_OPEN_TRANSACTION"
    );
  }

  const actualReturnAt = new Date();

  // 3. Compute Duration and Punctuality
  const custodyDurationMinutes = Math.max(
    1,
    Math.floor((actualReturnAt.getTime() - new Date(openTx.timestamp).getTime()) / (60 * 1000))
  );

  const punctuality = evaluateReturnPunctuality(actualReturnAt, openTx.returnDeadlineAt);
  const returnStatus = punctuality.returnStatus;
  const overdueMinutes = punctuality.overdueMinutes;

  // 4. Condition Validation (Remarks mandatory if damaged or missing accessories)
  const isDamagedOrMissing =
    params.conditionAtAction === "MINOR_DAMAGE" ||
    params.conditionAtAction === "MAJOR_DAMAGE" ||
    params.conditionAtAction === "NOT_FUNCTIONAL" ||
    params.conditionAtAction === "ACCESSORIES_MISSING";

  if (isDamagedOrMissing && (!params.conditionNotes && !params.remarks)) {
    throw new CustodyError(
      `Condition is reported as ${params.conditionAtAction}. Detailed remarks/condition notes are mandatory.`,
      422,
      "CONDITION_REMARKS_REQUIRED"
    );
  }

  // 5. Atomic Database Transaction
  const result = await db.$transaction(async (tx) => {
    // 5a. Update open CustodyTransaction record (closes the checkout cycle)
    const updatedTx = await tx.custodyTransaction.update({
      where: { id: openTx.id },
      data: {
        status: "RETURNED",
        actualReturnAt,
        returnStatus,
        custodyDurationMinutes,
        overdueMinutes,
        conditionAtAction: params.conditionAtAction,
        accessoriesReturned: params.accessoriesReturned || "All returned",
        conditionNotes: params.conditionNotes || null,
        photoEvidenceUrl: params.photoEvidenceUrl || null,
        remarks: params.remarks || openTx.remarks,
        isManualOverride: params.isManualOverride || openTx.isManualOverride,
        overrideReason: params.overrideReason || openTx.overrideReason,
        surrenderedByRepresentative: params.surrenderedByRepresentative || false,
        representativeName: params.representativeName || null,
      },
    });

    // 5b. Create dedicated Return / Time Out CustodyTransaction record for turnstile telemetry
    const txType = params.transactionType || (openTx.transactionType === "TIME_IN" ? "TIME_OUT" : "SURRENDER");
    const prefix = txType === "TIME_OUT" ? "CTX-OUT" : "CTX-SUR";
    const returnTxCode = `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const returnTx = await tx.custodyTransaction.create({
      data: {
        transactionCode: returnTxCode,
        transactionType: txType,
        status: "RETURNED",
        returnStatus,
        custodyDurationMinutes,
        overdueMinutes,
        phoneAssetId: openTx.phoneAssetId,
        employeeId: openTx.employeeId,
        nfcCardId: openTx.nfcCardId,
        nfcReaderId: params.nfcReaderId || openTx.nfcReaderId || null,
        handledByUserId: params.handledByUserId || null,
        timestamp: actualReturnAt,
        actualReturnAt,
        conditionAtAction: params.conditionAtAction,
        accessoriesReturned: params.accessoriesReturned || "All returned",
        conditionNotes: params.conditionNotes || null,
        photoEvidenceUrl: params.photoEvidenceUrl || null,
        remarks: params.remarks || (txType === "TIME_OUT" ? "Phone Timed Out" : "Phone Surrendered"),
        isManualOverride: params.isManualOverride || false,
        overrideReason: params.overrideReason || null,
        surrenderedByRepresentative: params.surrenderedByRepresentative || false,
        representativeName: params.representativeName || null,
        verifiedViaNfc: !params.isManualOverride,
      },
    });

    // 5c. Update ReturnDeadline record
    await tx.returnDeadline.updateMany({
      where: { custodyTransactionId: openTx.id },
      data: {
        status: returnStatus === "LATE" ? "RETURNED_LATE" : "RETURNED_ON_TIME",
        actualReturnAt,
      },
    });

    // 5d. Resolve any open OverdueCase
    await tx.overdueCase.updateMany({
      where: {
        custodyTransactionId: openTx.id,
        status: { in: ["OPEN", "ESCALATED"] },
      },
      data: {
        status: "RESOLVED",
        resolvedAt: actualReturnAt,
        resolutionType: "SURRENDERED",
        resolutionNotes: `Surrendered via custody return. Condition: ${params.conditionAtAction}. Return Status: ${returnStatus}`,
      },
    });

    // 5e. Determine New Phone Operational & Custody Status
    let newOperationalStatus = openTx.phoneAsset?.operationalStatus || "ACTIVE";
    if (params.conditionAtAction === "MAJOR_DAMAGE" || params.conditionAtAction === "NOT_FUNCTIONAL") {
      newOperationalStatus = "UNDER_MAINTENANCE";
    }

    const updatedPhone = openTx.phoneAssetId ? await tx.phoneAsset.update({
      where: { id: openTx.phoneAssetId },
      data: {
        custodyStatus: "AVAILABLE",
        operationalStatus: newOperationalStatus,
        condition: params.conditionAtAction === "NOT_FUNCTIONAL" ? "DAMAGED" : params.conditionAtAction,
      },
    }) : null;

    // 5f. Automatically Create Incident for Major Damage, Non-Functional, or Missing Accessories
    let createdIncident = null;
    if (
      params.conditionAtAction === "MAJOR_DAMAGE" ||
      params.conditionAtAction === "NOT_FUNCTIONAL" ||
      params.conditionAtAction === "ACCESSORIES_MISSING"
    ) {
      const incNumber = `INC-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
      const severity = params.conditionAtAction === "NOT_FUNCTIONAL" ? "CRITICAL" : "HIGH";
      const incidentType =
        params.conditionAtAction === "ACCESSORIES_MISSING"
          ? "LOSS"
          : params.conditionAtAction === "NOT_FUNCTIONAL"
          ? "MALFUNCTION"
          : "DAMAGE";

      if (openTx.phoneAssetId && openTx.employeeId) {
        createdIncident = await tx.incident.create({
          data: {
            incidentNumber: incNumber,
            phoneAssetId: openTx.phoneAssetId,
            employeeId: openTx.employeeId,
            reportedByUserId: params.handledByUserId || openTx.handledByUserId || "system",
            incidentType,
            severity,
            status: "REPORTED",
            description: `Automatic incident triggered on device return. Asset: ${openTx.phoneAsset?.assetTag || "Phone"}. Condition: ${params.conditionAtAction}. Notes: ${params.conditionNotes || params.remarks || "No additional notes"}`,
            custodyTransactionId: returnTx.id,
          },
        });
      }
    }

    // 5g. Create Immutable Custody Event
    const eventType =
      params.conditionAtAction === "MAJOR_DAMAGE" || params.conditionAtAction === "NOT_FUNCTIONAL"
        ? "DAMAGED_ON_RETURN"
        : params.surrenderedByRepresentative
        ? "REPRESENTATIVE_RETURN"
        : "CHECKED_IN";

    if (openTx.phoneAssetId && openTx.employeeId) {
      await tx.custodyEvent.create({
        data: {
          transactionId: returnTx.id,
          phoneAssetId: openTx.phoneAssetId,
          employeeId: openTx.employeeId,
          eventType,
          actorUserId: params.handledByUserId || null,
          details: `Surrendered phone ${openTx.phoneAsset?.assetTag || "Phone"}. Return status: ${returnStatus} (${custodyDurationMinutes} mins). Condition: ${params.conditionAtAction}.`,
        },
      });
    }

    return { returnTx, updatedTx, updatedPhone, createdIncident };
  });

  // 6. Audit Log
  await recordAuditLog({
    userId: params.handledByUserId,
    action: "CUSTODY_SURRENDER",
    entityType: "CUSTODY_TRANSACTION",
    entityId: result.returnTx.id,
    changes: {
      transactionCode: result.returnTx.transactionCode,
      transactionType: result.returnTx.transactionType,
      phoneAssetTag: openTx.phoneAsset?.assetTag || "Phone",
      returnStatus,
      overdueMinutes,
      conditionAtAction: params.conditionAtAction,
      custodyDurationMinutes,
      incidentCreated: !!result.createdIncident,
    },
  });

  return {
    success: true,
    transaction: result.returnTx,
    openTransaction: result.updatedTx,
    phone: result.updatedPhone,
    incident: result.createdIncident,
    returnStatus,
    overdueMinutes,
    custodyDurationMinutes,
    message:
      returnStatus === "LATE"
        ? `Device ${openTx.phoneAsset ? openTx.phoneAsset.assetTag : "Phone"} surrendered LATE by ${overdueMinutes} mins. Custody released.`
        : `Device ${openTx.phoneAsset ? openTx.phoneAsset.assetTag : "Phone"} surrendered ON TIME. Custody released.`,
  };
}
