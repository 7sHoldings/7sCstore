import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import UserForm from "./UserForm";
import UserRow from "./UserRow";

export const dynamic = "force-dynamic";

const MATRIX_ROWS: [string, string[]][] = [
  ["View everything", ["full", "partial", "partial", "none"]],
  ["Enter daily sales", ["full", "full", "none", "limited"]],
  ["Enter expenses", ["full", "full", "none", "none"]],
  ["Enter purchases", ["full", "full", "none", "none"]],
  ["Edit / delete records", ["full", "partial", "none", "none"]],
  ["View profit reports", ["full", "partial", "full", "none"]],
  ["Export reports", ["full", "partial", "full", "none"]],
  ["Manage users", ["full", "none", "none", "none"]],
];

const MARK: Record<string, { icon: string; tone: string }> = {
  full: { icon: "✓", tone: "text-secondary" },
  partial: { icon: "◑", tone: "text-tertiary" },
  limited: { icon: "◑", tone: "text-tertiary" },
  none: { icon: "—", tone: "text-on-surface-variant/50" },
};

export default async function UsersPage() {
  const session = (await getSession())!;
  if (!can(session.role, "manageUsers")) {
    return <Card className="p-8"><EmptyState icon="lock" title="No access" hint="Only owners can manage users." /></Card>;
  }

  const [users, auditLogs] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({ orderBy: { timestamp: "desc" }, take: 15, include: { user: true } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Users & Permissions"
        subtitle="Manage who can access 7sCstores and what they can do"
        actions={<UserForm />}
      />

      <Card className="overflow-hidden mb-6">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/40">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  id={u.id}
                  name={u.name}
                  email={u.email}
                  role={u.role}
                  active={u.active}
                  isSelf={u.id === session.userId}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Permission matrix */}
      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">Permission Matrix</div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3 text-center">Owner</th>
                <th className="px-4 py-3 text-center">Manager</th>
                <th className="px-4 py-3 text-center">Accountant</th>
                <th className="px-4 py-3 text-center">Employee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/40">
              {MATRIX_ROWS.map(([action, marks]) => (
                <tr key={action}>
                  <td className="px-4 py-2.5 text-on-surface">{action}</td>
                  {marks.map((m, i) => (
                    <td key={i} className={`px-4 py-2.5 text-center font-bold ${MARK[m].tone}`} title={m}>
                      {MARK[m].icon}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-body-sm text-on-surface-variant flex gap-4">
          <span className="text-secondary font-bold">✓ full</span>
          <span className="text-tertiary font-bold">◑ partial / limited</span>
          <span className="text-on-surface-variant/60 font-bold">— none</span>
        </div>
      </Card>

      {/* Audit trail */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface flex items-center justify-between">
          Recent Activity (Audit Log)
          <Badge tone="info">{auditLogs.length} latest</Badge>
        </div>
        {auditLogs.length === 0 ? (
          <EmptyState icon="history" title="No activity yet" />
        ) : (
          <ul className="divide-y divide-outline-variant/40">
            {auditLogs.map((log) => (
              <li key={log.id} className="px-4 py-3 flex items-center justify-between text-body-sm">
                <div>
                  <span className="font-medium text-on-surface">{log.user?.name ?? "System"}</span>
                  <span className="text-on-surface-variant"> {log.action.toLowerCase()} </span>
                  <span className="text-on-surface">{log.entity}</span>
                </div>
                <span className="text-on-surface-variant">{fmtDateTime(log.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
