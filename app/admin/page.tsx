"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string; email: string; fullName: string; role: string; status: string;
  createdAt: string; lastLoginAt: string | null; _count: { auditLogs: number };
}
interface AuditLog {
  id: string; action: string; details: Record<string, unknown>; createdAt: string;
  ipAddress: string | null; user: { email: string; fullName: string };
}
interface Toast { id: number; msg: string; type: "success" | "error"; }
interface ConfirmDialog { title: string; body: string; onConfirm: () => void; danger?: boolean; confirmLabel?: string; }

let toastCounter = 0;

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="flex items-center gap-2 px-5 py-3 rounded-full text-sm font-medium shadow-2xl"
          style={{ background: t.type === "error" ? "#ef4444" : "var(--accent)", color: "white", animation: "slideUp 0.2s ease" }}>
          {t.type === "success" && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function ConfirmModal({ dialog, onClose }: { dialog: ConfirmDialog; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="rounded-2xl p-6 w-[380px] shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-5">
          {dialog.danger && (
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(239,68,68,0.15)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="w-5 h-5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
          )}
          <div className="flex-1">
            <h3 className="font-semibold text-base mb-1.5" style={{ color: "var(--text-primary)" }}>{dialog.title}</h3>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{dialog.body}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Cancel</button>
          <button onClick={() => { dialog.onConfirm(); onClose(); }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: dialog.danger ? "#ef4444" : "var(--accent)", color: "white" }}>{dialog.confirmLabel ?? "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_OPTIONS = ["ACTIVE", "DISABLED", "SUSPENDED"];
const ROLE_OPTIONS = ["USER", "ADMIN"];

const statusColor: Record<string, string> = { ACTIVE: "#22c55e", DISABLED: "#ef4444", SUSPENDED: "#f59e0b" };
const statusBg: Record<string, string> = { ACTIVE: "rgba(34,197,94,0.12)", DISABLED: "rgba(239,68,68,0.12)", SUSPENDED: "rgba(245,158,11,0.12)" };

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"users" | "logs">("users");
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", fullName: "", password: "", role: "USER" });
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);

  function showToast(msg: string, type: Toast["type"] = "success") {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }

  function confirm(dialog: ConfirmDialog) { setConfirmDialog(dialog); }

  async function fetchUsers() {
    const res = await fetch("/api/admin/users");
    if (res.status === 403) { router.push("/dashboard"); return; }
    if (res.ok) { const data = await res.json(); setUsers(data.users || []); }
    setLoading(false);
  }
  async function fetchLogs() {
    const res = await fetch("/api/admin/audit-logs");
    if (res.ok) { const data = await res.json(); setLogs(data.logs || []); }
  }
  useEffect(() => { fetchUsers(); fetchLogs(); }, []);

  async function createUser() {
    setFormError("");
    if (!form.email || !form.fullName || !form.password) { setFormError("All fields required"); return; }
    setCreating(true);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) { setFormError(data.error || "Failed to create user"); return; }
    setShowCreate(false);
    setForm({ email: "", fullName: "", password: "", role: "USER" });
    fetchUsers();
    showToast("User created");
  }

  async function updateUserField(id: string, field: string, value: string, label: string) {
    setUpdatingId(id);
    const res = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    setUpdatingId(null);
    if (res.ok) { fetchUsers(); showToast(`${label} updated`); }
    else showToast(`Failed to update ${label.toLowerCase()}`, "error");
  }

  function handleDeleteUser(user: User) {
    confirm({
      title: "Delete user permanently?",
      body: `This will permanently delete ${user.fullName} (${user.email}) and all their data. This action cannot be undone.`,
      confirmLabel: "Yes, delete user",
      danger: true,
      onConfirm: async () => {
        setDeletingId(user.id);
        const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
        setDeletingId(null);
        if (res.ok) { fetchUsers(); showToast("User deleted"); }
        else showToast("Failed to delete user", "error");
      },
    });
  }

  function handleRoleChange(user: User, newRole: string) {
    if (newRole === user.role) return;
    confirm({
      title: `Change role to ${newRole}?`,
      body: newRole === "ADMIN"
        ? `${user.fullName} will gain full admin access including user management and audit logs.`
        : `${user.fullName} will lose admin access and only have standard user permissions.`,
      confirmLabel: `Set as ${newRole}`,
      danger: newRole === "ADMIN",
      onConfirm: () => updateUserField(user.id, "role", newRole, "Role"),
    });
  }

  const inputStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

      <div className="border-b px-6 py-4 flex items-center gap-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
          Dashboard
        </button>
        <span style={{ color: "var(--border)" }}>·</span>
        <h1 className="font-semibold">Admin Panel</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: "var(--surface)" }}>
          {(["users", "logs"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="px-5 py-2 rounded-lg text-sm font-medium capitalize transition-colors"
              style={{ background: tab === t ? "var(--surface-2)" : "transparent", color: tab === t ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {t === "users" ? `Users (${users.length})` : "Audit Logs"}
            </button>
          ))}
        </div>

        {tab === "users" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Manage Users</h2>
              <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--accent)", color: "white" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create user
              </button>
            </div>

            {showCreate && (
              <div className="mb-6 p-5 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium">New user</h3>
                  <button onClick={() => { setShowCreate(false); setFormError(""); }} style={{ color: "var(--text-secondary)" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                {formError && (
                  <div className="mb-3 px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>{formError}</div>
                )}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[{ label: "Full Name", key: "fullName", type: "text" }, { label: "Email", key: "email", type: "email" }, { label: "Password", key: "password", type: "password" }].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{f.label}</label>
                      <input type={f.type} value={form[f.key as keyof typeof form]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Role</label>
                    <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}>
                      <option value="USER">User</option><option value="ADMIN">Admin</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={createUser} disabled={creating} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: "var(--accent)", color: "white" }}>
                    {creating && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                    {creating ? "Creating…" : "Create user"}
                  </button>
                  <button onClick={() => { setShowCreate(false); setFormError(""); }} className="px-4 py-2 rounded-lg text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Cancel</button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3" style={{ color: "var(--text-secondary)" }}>
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Loading users…
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                      {["User", "Role", "Status", "Last Login", "Actions"].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const isUpdating = updatingId === u.id;
                      const isDeleting = deletingId === u.id;
                      return (
                        <tr key={u.id} style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", opacity: isDeleting ? 0.4 : 1, transition: "opacity 0.2s" }}>
                          <td className="px-4 py-3">
                            <p className="font-medium">{u.fullName}</p>
                            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{u.email}</p>
                          </td>
                          {/* Role — inline dropdown with confirmation */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <select
                                value={u.role}
                                onChange={e => handleRoleChange(u, e.target.value)}
                                disabled={isUpdating || isDeleting}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium outline-none cursor-pointer disabled:opacity-50"
                                style={{
                                  background: u.role === "ADMIN" ? "rgba(99,102,241,0.15)" : "var(--surface-2)",
                                  color: u.role === "ADMIN" ? "var(--accent)" : "var(--text-secondary)",
                                  border: `1px solid ${u.role === "ADMIN" ? "rgba(99,102,241,0.3)" : "var(--border)"}`,
                                }}>
                                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                              {isUpdating && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                            </div>
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3">
                            <select
                              value={u.status}
                              onChange={e => updateUserField(u.id, "status", e.target.value, "Status")}
                              disabled={isUpdating || isDeleting}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium outline-none cursor-pointer disabled:opacity-50"
                              style={{
                                background: statusBg[u.status] || "var(--surface-2)",
                                color: statusColor[u.status] || "var(--text-secondary)",
                                border: `1px solid ${statusColor[u.status] || "var(--border)"}33`,
                              }}>
                              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleDeleteUser(u)} disabled={isDeleting || isUpdating} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
                              style={{ color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.05)" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.15)"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.05)"; }}>
                              {isDeleting ? <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>}
                              {isDeleting ? "Deleting…" : "Delete"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {users.length === 0 && !loading && <div className="py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>No users found</div>}
              </div>
            )}
          </div>
        )}

        {tab === "logs" && (
          <div>
            <h2 className="font-semibold mb-4">Audit Logs</h2>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    {["User", "Action", "Details", "IP", "Time"].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                      <td className="px-4 py-3"><p className="font-medium">{log.user.fullName}</p><p className="text-xs" style={{ color: "var(--text-secondary)" }}>{log.user.email}</p></td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>{log.action}</span></td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: "var(--text-secondary)" }}>{JSON.stringify(log.details)}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>{log.ipAddress || "—"}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && <div className="py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>No logs yet</div>}
            </div>
          </div>
        )}
      </div>

      <ToastStack toasts={toasts} />
      {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
    </div>
  );
}