import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();

  if (!user) {
    redirect("/login");
  }

  // Kiosk account can ONLY access /kiosk mode, never the dashboard
  if (user.roleCode === "KIOSK") {
    redirect("/kiosk");
  }

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
