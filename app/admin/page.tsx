"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  _count: { auditLogs: number };
}

interface AuditLog {
  id: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  ipAddress: string | null;
  user: { email: string; fullName: string };
}

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"users" | "logs">("users");
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", fullName: "", password: "", role: "USER" });
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

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
    if (!form.email || !form.fullName || !form.password) {
      setFormError("All fields required"); return;
    }
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setFormError(data.error || "Failed"); return; }
    setShowCreate(false);
    setForm({ email: "", fullName: "", password: "", role: "USER" });
    fetchUsers();
    showToast("User created");
  }

  async function updateUser(id: string, data: Record<string, string>) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) { fetchUsers(); showToast("User updated"); }
  }

  async function deleteUser(id: string) {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) { fetchUsers(); showToast("User deleted"); }
  }

  const statusColor: Record<string, string> = {
    ACTIVE: "#22c55e",
    DISABLED: "#ef4444",
    SUSPENDED: "#f59e0b",
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center gap-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Dashboard
        </button>
        <span style={{ color: "var(--border)" }}>·</span>
        <h1 className="font-semibold">Admin Panel</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: "var(--surface)" }}>
          {(["users", "logs"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-5 py-2 rounded-lg text-sm font-medium capitalize transition-colors"
              style={{
                background: tab === t ? "var(--surface-2)" : "transparent",
                color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
              }}>
              {t === "users" ? "Users" : "Audit Logs"}
            </button>
          ))}
        </div>

        {tab === "users" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Users ({users.length})</h2>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--accent)", color: "white" }}>
                + Create user
              </button>
            </div>

            {showCreate && (
              <div className="mb-6 p-5 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h3 className="font-medium mb-4">New user</h3>
                {formError && <p className="text-sm mb-3" style={{ color: "#f87171" }}>{formError}</p>}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: "Full Name", key: "fullName", type: "text" },
                    { label: "Email", key: "email", type: "email" },
                    { label: "Password", key: "password", type: "password" },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{f.label}</label>
                      <input type={f.type} value={form[f.key as keyof typeof form]}
                        onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Role</label>
                    <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                      <option value="USER">User</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={createUser}
                    className="px-4 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--accent)", color: "white" }}>Create</button>
                  <button onClick={() => { setShowCreate(false); setFormError(""); }}
                    className="px-4 py-2 rounded-lg text-sm"
                    style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Cancel</button>
                </div>
              </div>
            )}

            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    {["Name", "Email", "Role", "Status", "Last Login", "Actions", "Actions"].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                      <td className="px-4 py-3 font-medium">{u.fullName}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{u.email}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs"
                          style={{ background: u.role === "ADMIN" ? "rgba(99,102,241,0.2)" : "var(--surface-2)", color: u.role === "ADMIN" ? "var(--accent)" : "var(--text-secondary)" }}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor[u.status] || "#9ca3af" }} />
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.status}
                          onChange={e => updateUser(u.id, { status: e.target.value })}
                          className="px-2 py-1 rounded text-xs outline-none"
                          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                          <option value="ACTIVE">Active</option>
                          <option value="DISABLED">Disabled</option>
                          <option value="SUSPENDED">Suspended</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteUser(u.id)}
                          className="text-xs px-2 py-1 rounded transition-colors"
                          style={{ color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && !loading && (
                <div className="py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>No users found</div>
              )}
            </div>
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
                      <th key={i} className="px-4 py-3 text-left text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{log.user.fullName}</p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{log.user.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-mono"
                          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: "var(--text-secondary)" }}>
                        {JSON.stringify(log.details)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                        {log.ipAddress || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && (
                <div className="py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>No logs yet</div>
              )}
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-full text-sm font-medium shadow-xl z-50"
          style={{ background: "var(--accent)", color: "white" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
