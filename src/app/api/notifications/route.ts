import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/lib/notifications/service";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "30", 10);
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const userId = session?.userId || null;
    const roleCode = session?.roleCode || null;

    const [notifications, unreadCount] = await Promise.all([
      getUserNotifications(userId, roleCode, limit, unreadOnly),
      getUnreadNotificationCount(userId, roleCode),
    ]);

    return NextResponse.json({
      notifications,
      unreadCount,
    });
  } catch (error: any) {
    console.error("[GET /api/notifications] Error:", error);
    return NextResponse.json({ error: "Failed to load notifications", details: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const userId = session?.userId || null;
    const roleCode = session?.roleCode || null;

    if (body.all) {
      await markAllNotificationsAsRead(userId, roleCode);
      return NextResponse.json({ success: true, message: "All notifications marked as read." });
    }

    if (body.id) {
      await markNotificationAsRead(body.id);
      return NextResponse.json({ success: true, message: "Notification marked as read." });
    }

    return NextResponse.json({ error: "Notification ID or 'all: true' is required" }, { status: 400 });
  } catch (error: any) {
    console.error("[PATCH /api/notifications] Error:", error);
    return NextResponse.json({ error: "Failed to update notification status", details: error.message }, { status: 500 });
  }
}
