import React from "react";
import { UserCog, Terminal } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ROLES, RoleCode } from "@/lib/rbac";
import { ChangePasswordModal } from "@/components/users/change-password-modal";

export const revalidate = 0;

export default async function UsersPage() {
  const [session, users] = await Promise.all([
    getSession(),
    db.user.findMany({
      include: {
        department: true,
        userRoles: {
          include: { role: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const isSystemAdmin = session?.roleCode === "SYSTEM_ADMIN";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              User &amp; Role Administration
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              System Admin Only
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            System access control, role assignment, and user account password management
          </p>
        </div>

        {session && (
          <ChangePasswordModal
            targetUserId={session.userId}
            targetEmail={session.email}
            targetFullName={session.fullName}
            isSelf={true}
            buttonLabel="Change My Password"
          />
        )}
      </div>

      {/* CLI Provisioning Documentation Banner */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100 text-xs space-y-2">
        <div className="flex items-center space-x-2 text-indigo-400 font-semibold">
          <Terminal className="w-4 h-4" />
          <span>Administrator Password Management (Web UI &amp; CLI)</span>
        </div>
        <p className="text-slate-300 leading-relaxed">
          You can change your administrator password directly in the web app using the <strong>Change Password</strong> button in the table below (or top header), or via CLI if locked out:
        </p>
        <pre className="p-2.5 rounded-lg bg-black text-emerald-400 font-mono text-[11px] overflow-x-auto">
          node scripts/create-admin.mjs --email=&quot;admin@company.local&quot; --name=&quot;System Administrator&quot;
        </pre>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No Users Registered"
          description="Execute the admin provisioning script to create initial system users."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-4">Full Name</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Department</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Last Login</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => {
                  const roleCode = (u.userRoles[0]?.role.code || "AUDITOR") as RoleCode;
                  const roleMeta = ROLES[roleCode];
                  const isCurrentUser = session?.userId === u.id;
                  const canChangeThisUser =
                    roleCode !== "KIOSK" && (isCurrentUser || isSystemAdmin);

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/50">
                      <td className="p-4 font-semibold text-slate-800 dark:text-slate-200">
                        {u.fullName}
                      </td>
                      <td className="p-4 font-mono text-slate-600 dark:text-slate-400">
                        {u.email}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            roleMeta?.badgeColor || "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {roleMeta?.name || roleCode}
                        </span>
                      </td>
                      <td className="p-4 text-slate-600 dark:text-slate-400">
                        {u.department?.name || "Global Scope"}
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {u.isActive ? "ACTIVE" : "DISABLED"}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-slate-500">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                      </td>
                      <td className="p-4 text-right">
                        {canChangeThisUser ? (
                          <ChangePasswordModal
                            targetUserId={u.id}
                            targetEmail={u.email}
                            targetFullName={u.fullName}
                            isSelf={isCurrentUser}
                            buttonLabel="Change Password"
                          />
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            Managed Hardware Token
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
