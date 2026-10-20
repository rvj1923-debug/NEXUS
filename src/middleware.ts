import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { canAccessPath } from "@/lib/rbac";
import {
  SESSION_COOKIE_NAME,
  STRICT_SESSION_VERSION,
  KIOSK_SESSION_EXPIRATION,
  KIOSK_COOKIE_MAX_AGE,
  KIOSK_RENEWAL_THRESHOLD_SECONDS,
  getJwtSecretKey,
  type SessionUser,
} from "@/lib/session-config";

const PUBLIC_PATHS = [
  "/login",
  "/supervisor-form",
  "/overdue/print-report",
  "/api/auth/login",
  "/api/auth/logout",
  "/unauthorized",
  "/api/health",
  "/api/overdue",
  "/api/overdue/supervisor-review",
  "/api/kiosk/device-login",
  "/kiosk/not-provisioned",
];

function isHttpsRequest(request: NextRequest): boolean {
  const envKey = "APP_URL";
  const configuredUrl = (
    (typeof process !== "undefined" && process.env ? process.env[envKey] : "") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).trim();
  if (configuredUrl) {
    return configuredUrl.startsWith("https://");
  }
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  }
  return request.nextUrl.protocol === "https:";
}

async function attachRefreshedKioskCookie(
  request: NextRequest,
  res: NextResponse,
  user: SessionUser
): Promise<NextResponse> {
  try {
    const freshToken = await new SignJWT({
      user,
      sessionVersion: STRICT_SESSION_VERSION,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(KIOSK_SESSION_EXPIRATION)
      .sign(getJwtSecretKey());

    const isHttps = isHttpsRequest(request);
    res.cookies.set(SESSION_COOKIE_NAME, freshToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: KIOSK_COOKIE_MAX_AGE,
    });
  } catch {
    // Ignore signing failure and return response as-is
  }
  return res;
}

function buildRedirectUrl(request: NextRequest, target: string): URL {
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (request.nextUrl.protocol ? request.nextUrl.protocol.replace(":", "") : "http");
  const rawHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host ||
    "localhost:5000";
  const safeHost = rawHost.replace(/^0\.0\.0\.0(?=[:/]|$)/, "localhost");
  return new URL(target, `${proto}://${safeHost}`);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. Allow static resources and Next internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/public") ||
    pathname === "/favicon.ico" ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Validate SESSION_SECRET immediately on first request (throws in production if missing or < 32 chars)
  const jwtSecretKey = getJwtSecretKey();

  // 2. Read and strictly verify session cookie (no clockTolerance bypass)
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let sessionUser: SessionUser | null = null;
  let shouldRefreshKioskCookie = false;

  if (sessionCookie) {
    try {
      const { payload } = await jwtVerify(sessionCookie, jwtSecretKey);
      if ((payload as { sessionVersion?: string }).sessionVersion === STRICT_SESSION_VERSION) {
        sessionUser = (payload as { user: SessionUser }).user || null;
        if (sessionUser?.roleCode === "KIOSK") {
          const iat = typeof payload.iat === "number" ? payload.iat : 0;
          const nowSec = Math.floor(Date.now() / 1000);
          if (nowSec - iat > KIOSK_RENEWAL_THRESHOLD_SECONDS) {
            shouldRefreshKioskCookie = true;
          }
        }
      } else {
        sessionUser = null;
      }
    } catch {
      // Invalid or expired token
      sessionUser = null;
    }
  }

  // 3. Handle root redirect
  if (pathname === "/") {
    if (sessionUser) {
      if (sessionUser.roleCode === "KIOSK") {
        const res = NextResponse.redirect(buildRedirectUrl(request, "/kiosk"));
        return shouldRefreshKioskCookie ? attachRefreshedKioskCookie(request, res, sessionUser) : res;
      }
      if (sessionUser.roleCode === "HR_ADMIN") {
        return NextResponse.redirect(buildRedirectUrl(request, "/overdue"));
      }
      return NextResponse.redirect(buildRedirectUrl(request, "/dashboard"));
    } else {
      const res = NextResponse.redirect(buildRedirectUrl(request, "/login"));
      if (sessionCookie) res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
    }
  }

  // 4. Handle public pages like /login, /supervisor-form, /overdue/print-report, /kiosk/not-provisioned
  // Note: /api/overdue is public ONLY for exact path or /api/overdue/<caseId> GET for supervisor form & printable report;
  // /api/overdue/hr-remove-incident and /api/overdue/email-config require login!
  const isProtectedOverdueApi =
    pathname.startsWith("/api/overdue/hr-remove-incident") ||
    pathname.startsWith("/api/overdue/email-config");

  const isPublicPath =
    !isProtectedOverdueApi &&
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (isPublicPath) {
    if (sessionUser && pathname === "/login") {
      if (sessionUser.roleCode === "KIOSK") {
        const res = NextResponse.redirect(buildRedirectUrl(request, "/kiosk"));
        return shouldRefreshKioskCookie ? attachRefreshedKioskCookie(request, res, sessionUser) : res;
      }
      const nextParam = request.nextUrl.searchParams.get("next");
      if (sessionUser.roleCode === "HR_ADMIN") {
        if (nextParam && nextParam.startsWith("/overdue")) {
          return NextResponse.redirect(buildRedirectUrl(request, nextParam));
        }
        return NextResponse.redirect(buildRedirectUrl(request, "/overdue"));
      }
      if (nextParam && nextParam.startsWith("/")) {
        return NextResponse.redirect(buildRedirectUrl(request, nextParam));
      }
      return NextResponse.redirect(buildRedirectUrl(request, "/dashboard"));
    }
    const res = NextResponse.next();
    return shouldRefreshKioskCookie && sessionUser
      ? attachRefreshedKioskCookie(request, res, sessionUser)
      : res;
  }

  // 4b. If a Department Supervisor opens /overdue?reviewCaseId=... from a notification or email, always redirect to /supervisor-form
  if (pathname === "/overdue" && request.nextUrl.searchParams.get("reviewCaseId")) {
    const reviewCaseId = request.nextUrl.searchParams.get("reviewCaseId")!;
    const formUrl = buildRedirectUrl(request, "/supervisor-form");
    formUrl.searchParams.set("caseId", reviewCaseId);
    const decisionParam = request.nextUrl.searchParams.get("decision");
    if (decisionParam) {
      formUrl.searchParams.set("decision", decisionParam);
    }
    return NextResponse.redirect(formUrl);
  }

  // 5. Require authentication for all other routes
  if (!sessionUser) {
    // When a request for /kiosk has no valid session, redirect to /api/kiosk/device-login (NOT /login)
    if (pathname === "/kiosk" || pathname.startsWith("/kiosk/")) {
      const deviceLoginUrl = buildRedirectUrl(request, "/api/kiosk/device-login");
      const res = NextResponse.redirect(deviceLoginUrl);
      if (sessionCookie) res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
    }

    // If HR clicks /api/auth/hr-access from the HR Dept email while not logged in:
    // - If mode=print, open /overdue/print-report directly without login
    // - Otherwise require login first and then automatically go to /overdue
    if (pathname === "/api/auth/hr-access") {
      const caseId =
        request.nextUrl.searchParams.get("caseId") ||
        request.nextUrl.searchParams.get("hrCaseId") ||
        "";
      const mode = request.nextUrl.searchParams.get("mode") || "overdue";
      if (mode === "print") {
        const printUrl = buildRedirectUrl(request, "/overdue/print-report");
        if (caseId) printUrl.searchParams.set("caseId", caseId);
        return NextResponse.redirect(printUrl);
      }
      const targetAfterLogin = caseId
        ? `/overdue?hrCaseId=${encodeURIComponent(caseId)}`
        : `/overdue`;

      const loginUrl = buildRedirectUrl(request, "/login");
      loginUrl.searchParams.set("next", targetAfterLogin);
      const res = NextResponse.redirect(loginUrl);
      if (sessionCookie) res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
    }

    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Unauthorized: Login required" }, { status: 401 });
      if (sessionCookie) res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
    }

    const loginUrl = buildRedirectUrl(request, "/login");
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    const res = NextResponse.redirect(loginUrl);
    if (sessionCookie) res.cookies.delete(SESSION_COOKIE_NAME);
    return res;
  }

  // 6. Enforce strict confinement for KIOSK role: ONLY /kiosk and kiosk APIs
  if (sessionUser.roleCode === "KIOSK") {
    const isKioskWebPage = pathname === "/kiosk" || pathname.startsWith("/kiosk/");
    const isAllowedKioskApi =
      pathname.startsWith("/api/kiosk") ||
      pathname === "/api/auth/logout" ||
      pathname === "/api/auth/me" ||
      pathname.startsWith("/api/readers") ||
      pathname === "/api/health" ||
      pathname.startsWith("/api/monitoring/time-in-out");

    if (!isKioskWebPage && !isAllowedKioskApi) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            error: "Forbidden: Kiosk account is restricted solely to Kiosk operations",
            role: sessionUser.roleCode,
          },
          { status: 403 }
        );
      }
      const res = NextResponse.redirect(buildRedirectUrl(request, "/kiosk"));
      return shouldRefreshKioskCookie ? attachRefreshedKioskCookie(request, res, sessionUser) : res;
    }
  }

  // 6b. Enforce HR Department account confinement to Overdue Monitoring (/overdue)
  if (sessionUser.roleCode === "HR_ADMIN") {
    const isHrAllowedWebPage =
      pathname === "/overdue" ||
      pathname.startsWith("/overdue/") ||
      pathname === "/hr-admin" ||
      pathname.startsWith("/hr-admin/");
    const isHrAllowedApi =
      pathname.startsWith("/api/overdue") ||
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/notifications") ||
      pathname === "/api/health";

    if (!isHrAllowedWebPage && !isHrAllowedApi) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            error: "Forbidden: HR Department account is restricted to Overdue Monitoring",
            role: sessionUser.roleCode,
          },
          { status: 403 }
        );
      }
      return NextResponse.redirect(buildRedirectUrl(request, "/overdue"));
    }
  }

  // 7. Enforce server-side Role-Based Access Control (RBAC) for all other roles
  const isAllowed = canAccessPath(sessionUser, pathname);
  if (!isAllowed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "Forbidden: You do not possess the required role permissions for this resource",
          role: sessionUser.roleCode,
        },
        { status: 403 }
      );
    }
    const unauthorizedUrl = buildRedirectUrl(request, "/unauthorized");
    unauthorizedUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(unauthorizedUrl);
  }

  const res = NextResponse.next();
  return shouldRefreshKioskCookie && sessionUser
    ? attachRefreshedKioskCookie(request, res, sessionUser)
    : res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
