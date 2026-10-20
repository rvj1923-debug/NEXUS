import { db } from "@/lib/db";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatManilaDateTime, formatManilaTime, formatManilaDate, getReportDateRange, COMPANY_TIMEZONE } from "@/lib/custody/timezone";

export interface ReportFilterOptions {
  dateFilter?: "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "QUARTER" | "CUSTOM";
  customStart?: string;
  customEnd?: string;
  departmentId?: string | null;
  employeeId?: string | null;
  phoneAssetId?: string | null;
  status?: string | null;
  custodianId?: string | null;
  grouping?: "NONE" | "DEPARTMENT" | "EMPLOYEE" | "PHONE" | "DATE";
}

export interface CustodyReportData {
  reportDateRange: string;
  startDate: Date;
  endDate: Date;
  summary: {
    totalRegistered: number;
    available: number;
    issuedDuringPeriod: number;
    returnedDuringPeriod: number;
    onTimeReturns: number;
    lateReturns: number;
    stillOutstanding: number; // End-of-period custody balance
    activeOverdueCases: number;
    damagedDevices: number;
    lostDevices: number;
  };
  transactions: any[];
  groupedData?: Record<string, any[]>;
}

/**
 * Computes authoritative daily custody report metrics and transactions
 */
export async function generateCustodyReport(options: ReportFilterOptions = {}): Promise<CustodyReportData> {
  const {
    dateFilter = "TODAY",
    customStart,
    customEnd,
    departmentId,
    employeeId,
    phoneAssetId,
    status,
    custodianId,
    grouping = "NONE",
  } = options;

  const { start, end, dateStr } = getReportDateRange(dateFilter, customStart, customEnd);

  // Base where clause for period transactions:
  // Includes transactions issued within period OR returned within period OR open transactions spanning the period
  const txWhere: any = {
    OR: [
      { timestamp: { gte: start, lte: end } },
      { actualReturnAt: { gte: start, lte: end } },
      {
        AND: [
          { timestamp: { lte: end } },
          { OR: [{ actualReturnAt: null }, { actualReturnAt: { gt: end } }] },
        ],
      },
    ],
  };

  if (departmentId && departmentId !== "ALL") {
    txWhere.employee = { departmentId };
  }
  if (employeeId) {
    txWhere.employeeId = employeeId;
  }
  if (phoneAssetId) {
    txWhere.phoneAssetId = phoneAssetId;
  }
  if (status && status !== "ALL") {
    txWhere.status = status;
  }
  if (custodianId) {
    txWhere.handledByUserId = custodianId;
  }

  // 1. Fetch Transactions
  const transactions = await db.custodyTransaction.findMany({
    where: txWhere,
    orderBy: { timestamp: "desc" },
    include: {
      employee: { include: { department: true } },
      phoneAsset: true,
      nfcCard: true,
      returnDeadline: true,
      overdueCases: true,
      incidents: true,
    },
  });

  // 2. Fetch Totals: Total phones are also the total employees registered
  const empWhere: any = { isActive: true };
  if (departmentId && departmentId !== "ALL") {
    empWhere.departmentId = departmentId;
  }
  const totalRegistered = await db.employee.count({
    where: empWhere,
  });

  const available = await db.phoneAsset.count({
    where: { custodyStatus: "AVAILABLE", operationalStatus: "ACTIVE", isActive: true },
  });

  const damagedDevices = await db.phoneAsset.count({
    where: { operationalStatus: { in: ["DAMAGED", "UNDER_MAINTENANCE"] }, isActive: true },
  });

  const lostDevices = await db.phoneAsset.count({
    where: { operationalStatus: "LOST" },
  });

  // 3. Compute Metrics for Period
  const issuedDuringPeriod = transactions.filter(
    (t) => t.timestamp >= start && t.timestamp <= end && (t.transactionType === "ISSUANCE" || t.transactionType === "TIME_IN")
  ).length;

  const returnedDuringPeriod = transactions.filter(
    (t) =>
      t.timestamp >= start &&
      t.timestamp <= end &&
      (t.transactionType === "SURRENDER" || t.transactionType === "TIME_OUT")
  ).length;

  const onTimeReturns = transactions.filter(
    (t) =>
      t.timestamp >= start &&
      t.timestamp <= end &&
      (t.transactionType === "SURRENDER" || t.transactionType === "TIME_OUT") &&
      t.returnStatus === "ON_TIME"
  ).length;

  const lateReturns = transactions.filter(
    (t) =>
      t.timestamp >= start &&
      t.timestamp <= end &&
      (t.transactionType === "SURRENDER" || t.transactionType === "TIME_OUT") &&
      t.returnStatus === "LATE"
  ).length;

  // End-of-period custody balance: Devices issued on or before 'end' that were NOT returned before 'end'
  const stillOutstanding = transactions.filter(
    (t) =>
      (t.transactionType === "ISSUANCE" || t.transactionType === "TIME_IN") &&
      t.timestamp <= end &&
      (!t.actualReturnAt || t.actualReturnAt > end) &&
      t.status !== "LOST"
  ).length;

  // Active Overdue Cases within period
  const activeOverdueCases = await db.overdueCase.count({
    where: {
      detectedAt: { lte: end },
      OR: [{ resolvedAt: null }, { resolvedAt: { gt: end } }],
    },
  });

  // 4. Grouping if requested
  let groupedData: Record<string, any[]> | undefined;
  if (grouping !== "NONE") {
    groupedData = {};
    for (const tx of transactions) {
      let groupKey = "Other";
      if (grouping === "DEPARTMENT") {
        groupKey = tx.employee?.department?.name || "Unassigned Department";
      } else if (grouping === "EMPLOYEE") {
        groupKey = `${tx.employee?.firstName} ${tx.employee?.lastName} (${tx.employee?.employeeCode})`;
      } else if (grouping === "PHONE") {
        groupKey = tx.phoneAsset?.assetTag || "Unassigned Phone";
      } else if (grouping === "DATE") {
        groupKey = formatManilaDate(tx.timestamp);
      }

      if (!groupedData[groupKey]) groupedData[groupKey] = [];
      groupedData[groupKey].push(tx);
    }
  }

  return {
    reportDateRange: dateStr,
    startDate: start,
    endDate: end,
    summary: {
      totalRegistered,
      available,
      issuedDuringPeriod,
      returnedDuringPeriod,
      onTimeReturns,
      lateReturns,
      stillOutstanding,
      activeOverdueCases,
      damagedDevices,
      lostDevices,
    },
    transactions,
    groupedData,
  };
}

/**
 * Generates Professional Multi-Sheet Excel (XLSX) File Buffer
 */
export function generateExcelReport(data: CustodyReportData): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary & KPI Metrics
  const summaryRows = [
    ["NEXUS — DAILY CUSTODY AUDIT REPORT (NFC-Enabled Exchange & Usage System)"],
    [`Reporting Period (${COMPANY_TIMEZONE}):`, data.reportDateRange],
    ["Generated At:", formatManilaDateTime(new Date())],
    [],
    ["METRIC", "COUNT", "DESCRIPTION"],
    ["Total Phones", data.summary.totalRegistered, "Total registered employees / phones"],
    ["Devices Issued (Period)", data.summary.issuedDuringPeriod, "Total issuance transactions during window"],
    ["Devices Returned (Period)", data.summary.returnedDuringPeriod, "Total surrender transactions received"],
    ["On-Time Returns", data.summary.onTimeReturns, "Returned within 24 hours of Time In"],
    ["Active Overdue Cases (>24h)", data.summary.activeOverdueCases, "Phones not timed out or surrendered after 24 hours"],
    ["Damaged Devices", data.summary.damagedDevices, "Assets quarantined for maintenance or repairs"],
    ["Lost Devices", data.summary.lostDevices, "Devices confirmed lost or retired"],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 30 }, { wch: 15 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary KPI");

  // Sheet 2: Detailed Custody Transaction Log
  const headers = [
    "Transaction Code",
    "Status",
    "Employee Code",
    "Employee Name",
    "Department",
    "Asset Tag",
    "Brand & Model",
    "Primary IMEI",
    "Time In / Issued (Manila)",
    "24-Hour Deadline (Manila)",
    "Time Out / Surrendered (Manila)",
    "Punctuality",
    "Duration (Min)",
    "Overdue Past 24h (Min)",
    "Supervisor Overtime Approval",
    "Condition",
    "NFC Tag Reference",
    "Manual Override",
    "Remarks",
  ];

  const dataRows = data.transactions.map((t) => {
    const ovdCase = t.overdueCases?.[0];
    const supDecision = ovdCase
      ? `${ovdCase.overtimeApprovalStatus}${ovdCase.supervisorRemarks ? ` (${ovdCase.supervisorRemarks})` : ""}`
      : "N/A";
    return [
      t.transactionCode,
      t.status,
      t.employee?.employeeCode || "",
      `${t.employee?.firstName || ""} ${t.employee?.lastName || ""}`,
      t.employee?.department?.name || "",
      t.phoneAsset?.assetTag || "",
      `${t.phoneAsset?.brand || ""} ${t.phoneAsset?.model || ""}`,
      t.phoneAsset?.imei || "",
      formatManilaDateTime(t.timestamp),
      formatManilaDateTime(t.returnDeadlineAt),
      t.actualReturnAt ? formatManilaDateTime(t.actualReturnAt) : "Still In Custody",
      t.returnStatus || (t.status === "ISSUED" ? "ACTIVE" : "PENDING"),
      t.custodyDurationMinutes ?? "",
      t.overdueMinutes ?? 0,
      supDecision,
      t.conditionAtAction || "GOOD",
      t.nfcCard?.cardUid || "N/A",
      t.isManualOverride ? "YES" : "NO",
      t.remarks || "",
    ];
  });

  const dataSheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  dataSheet["!cols"] = [
    { wch: 22 },
    { wch: 12 },
    { wch: 14 },
    { wch: 22 },
    { wch: 20 },
    { wch: 15 },
    { wch: 22 },
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 26 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 30 },
  ];

  XLSX.utils.book_append_sheet(wb, dataSheet, "Custody Ledger");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/**
 * Formula Injection Protection for CSV fields:
 * Neutralizes leading '=', '+', '-', '@'
 */
function sanitizeCsvValue(val: any): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  if (/^[=\+\-@]/.test(str)) {
    str = `'${str}`; // Prefix with single quote to prevent spreadsheet execution
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Generates CSV Export with Formula Injection Protection
 */
export function generateCsvReport(data: CustodyReportData): string {
  const headers = [
    "Transaction Code",
    "Status",
    "Employee Code",
    "Employee Name",
    "Department",
    "Asset Tag",
    "Brand",
    "Model",
    "IMEI",
    "Time In / Issued At (Manila)",
    "24-Hour Deadline (Manila)",
    "Time Out / Actual Return (Manila)",
    "Punctuality",
    "Custody Duration (Minutes)",
    "Overdue Past 24h (Minutes)",
    "Supervisor Overtime Approval",
    "Condition",
    "NFC Tag Reference",
    "Manual Override",
    "Remarks",
  ];

  const rows = data.transactions.map((t) => {
    const ovdCase = t.overdueCases?.[0];
    const supDecision = ovdCase
      ? `${ovdCase.overtimeApprovalStatus}${ovdCase.supervisorRemarks ? ` (${ovdCase.supervisorRemarks})` : ""}`
      : "N/A";
    return [
      sanitizeCsvValue(t.transactionCode),
      sanitizeCsvValue(t.status),
      sanitizeCsvValue(t.employee?.employeeCode),
      sanitizeCsvValue(`${t.employee?.firstName || ""} ${t.employee?.lastName || ""}`),
      sanitizeCsvValue(t.employee?.department?.name),
      sanitizeCsvValue(t.phoneAsset?.assetTag),
      sanitizeCsvValue(t.phoneAsset?.brand),
      sanitizeCsvValue(t.phoneAsset?.model),
      sanitizeCsvValue(t.phoneAsset?.imei),
      sanitizeCsvValue(formatManilaDateTime(t.timestamp)),
      sanitizeCsvValue(formatManilaDateTime(t.returnDeadlineAt)),
      sanitizeCsvValue(t.actualReturnAt ? formatManilaDateTime(t.actualReturnAt) : "Still In Custody"),
      sanitizeCsvValue(t.returnStatus || t.status),
      sanitizeCsvValue(t.custodyDurationMinutes ?? ""),
      sanitizeCsvValue(t.overdueMinutes ?? 0),
      sanitizeCsvValue(supDecision),
      sanitizeCsvValue(t.conditionAtAction),
      sanitizeCsvValue(t.nfcCard?.cardUid || "N/A"),
      sanitizeCsvValue(t.isManualOverride ? "YES" : "NO"),
      sanitizeCsvValue(t.remarks || ""),
    ];
  });

  const metaRows = [
    `"NEXUS — DAILY CUSTODY AUDIT REPORT (NFC-Enabled Exchange & Usage System)"`,
    `"Reporting Period: ${data.reportDateRange} (${COMPANY_TIMEZONE})"`,
    `"Generated At: ${formatManilaDateTime(new Date())}"`,
    `"Total Phones: ${data.summary.totalRegistered} | Active Overdue: ${data.summary.activeOverdueCases}"`,
    "",
  ];

  return [...metaRows, headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

/**
 * Generates Corporate PDF Audit Report using jsPDF & autoTable
 */
export function generatePdfReport(data: CustodyReportData): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // 1. Header Banner
  doc.setFillColor(30, 58, 138); // Navy blue #1e3a8a
  doc.rect(0, 0, 297, 24, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("NEXUS — DAILY CUSTODY AUDIT REPORT", 14, 12);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Reporting Window: ${data.reportDateRange} (${COMPANY_TIMEZONE})  |  Generated: ${formatManilaDateTime(new Date())}`,
    14,
    19
  );

  // 2. Summary KPI Box
  doc.setTextColor(33, 41, 54);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Executive Custody & Phones Summary", 14, 33);

  const kpiData = [
    [
      `Total Phones: ${data.summary.totalRegistered}`,
      `Issued (Period): ${data.summary.issuedDuringPeriod}`,
      `Returned (Period): ${data.summary.returnedDuringPeriod}`,
      `On-Time Returns: ${data.summary.onTimeReturns}`,
      `Active Overdue: ${data.summary.activeOverdueCases}`,
    ],
  ];

  autoTable(doc, {
    startY: 36,
    head: [],
    body: kpiData,
    theme: "grid",
    styles: { fontSize: 8, fontStyle: "bold", halign: "center", cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // 3. Transactions Detail Table
  const tableHeaders = [
    "Tx Code",
    "Status",
    "Employee",
    "Department",
    "Asset Tag",
    "Device Model",
    "Issued At",
    "Deadline / Return",
    "Punctuality",
    "Duration",
    "Condition",
  ];

  const tableBody = data.transactions.map((t) => [
    t.transactionCode,
    t.status,
    `${t.employee?.firstName || ""} ${t.employee?.lastName || ""}`,
    t.employee?.department?.name || "General",
    t.phoneAsset?.assetTag || "",
    `${t.phoneAsset?.brand || ""} ${t.phoneAsset?.model || ""}`,
    formatManilaTime(t.timestamp),
    t.actualReturnAt ? formatManilaTime(t.actualReturnAt) : formatManilaTime(t.returnDeadlineAt),
    t.returnStatus || (t.status === "ISSUED" ? "ACTIVE" : "PENDING"),
    t.custodyDurationMinutes !== null && t.custodyDurationMinutes !== undefined
      ? `${Math.floor(t.custodyDurationMinutes / 60)}h ${t.custodyDurationMinutes % 60}m`
      : "Active",
    t.conditionAtAction || "GOOD",
  ]);

  const currentY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`Custody Transaction Log (${data.transactions.length} records)`, 14, currentY);

  autoTable(doc, {
    startY: currentY + 3,
    head: [tableHeaders],
    body: tableBody,
    theme: "striped",
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 8, fontStyle: "bold" },
    styles: { fontSize: 7, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 18 },
      2: { cellWidth: 32 },
      3: { cellWidth: 26 },
      4: { cellWidth: 22 },
      5: { cellWidth: 30 },
      6: { cellWidth: 22 },
      7: { cellWidth: 26 },
      8: { cellWidth: 20 },
      9: { cellWidth: 18 },
      10: { cellWidth: 22 },
    },
    didDrawPage: (data) => {
      // Footer page numbers
      const pageStr = `Page ${doc.getNumberOfPages()}`;
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(pageStr, 280, 205, { align: "right" });
    },
  });

  return Buffer.from(doc.output("arraybuffer"));
}
