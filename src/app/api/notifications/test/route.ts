import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createNotification } from "@/lib/notifications/service";
import { sendEmail } from "@/lib/notifications/email";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json().catch(() => ({}));

    const targetEmail = body.to || process.env.NOTIFICATION_DEFAULT_RECIPIENT || "admin@company.local";
    const testTitle = body.title || "SYSTEM TEST: Overdue Notification Channel";
    const testMessage =
      body.message ||
      `This is a test notification generated from the NEXUS monitoring pipeline at ${new Date().toISOString()}.`;

    // 1. In-app notification
    const inApp = await createNotification({
      recipientUserId: session?.userId || null,
      title: testTitle,
      message: testMessage,
      type: "ALERT",
      severity: "MEDIUM",
      linkUrl: "/notifications",
    });

    // 2. Email delivery (SMTP or simulated fallback)
    const emailResult = await sendEmail({
      to: targetEmail,
      subject: `[NEXUS] ${testTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
          <h2 style="color: #4f46e5;">NEXUS Notification Test</h2>
          <p>${testMessage}</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #64748b;">Timestamp: ${new Date().toISOString()}</p>
        </div>
      `,
    });

    return NextResponse.json({
      success: true,
      inAppId: inApp.id,
      emailResult,
      message: "Test notification dispatched successfully.",
    });
  } catch (error: any) {
    console.error("[POST /api/notifications/test] Error:", error);
    return NextResponse.json({ error: "Failed to dispatch test notification", details: error.message }, { status: 500 });
  }
}
