import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

function buildRedirectUrl(req: NextRequest, target: string): URL {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (req.nextUrl.protocol ? req.nextUrl.protocol.replace(":", "") : "http");
  const rawHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.host ||
    "localhost:5000";
  const safeHost = rawHost.replace(/^0\.0\.0\.0(?=[:/]|$)/, "localhost");
  return new URL(target, `${proto}://${safeHost}`);
}

/**
 * HR Department Email Link Handler -> Requires Admin Login first, then automatically
 * opens the Admin Overdue Reports Tab (/overdue?hrCaseId=...) or Print Report page.
 */
export async function GET(req: NextRequest) {
  try {
    const caseId =
      req.nextUrl.searchParams.get("caseId") ||
      req.nextUrl.searchParams.get("hrCaseId") ||
      req.nextUrl.searchParams.get("hrClearCaseId") ||
      "";
    const mode = req.nextUrl.searchParams.get("mode") || "overdue";

    const targetPath =
      mode === "print" && caseId
        ? `/overdue/print-report?caseId=${encodeURIComponent(caseId)}`
        : caseId
        ? `/overdue?hrCaseId=${encodeURIComponent(caseId)}`
        : `/overdue`;

    const session = await getSession();

    // Require login if not authenticated
    if (!session) {
      const loginUrl = buildRedirectUrl(req, "/login");
      loginUrl.searchParams.set("next", targetPath);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.redirect(buildRedirectUrl(req, targetPath));
  } catch (err) {
    console.error("[GET /api/auth/hr-access] Error:", err);
    return NextResponse.redirect(buildRedirectUrl(req, "/login?next=/overdue"));
  }
}
