import { redirect } from "next/navigation";

export default function MonitoringRedirect() {
  redirect("/custody/live-monitor");
}
