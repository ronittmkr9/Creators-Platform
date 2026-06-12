"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

interface Creator {
  pk: string;
  username: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  nichePrimary: string | null;
  followerCount: string | null;
  addressCountry: string | null;
  addressCity: string | null;
  gender: string | null;
  creatorSize: string | null;
  profilePicture: string | null;
  email: string | null;
  collaborationStatus: string | null;
}

interface ListItem { id: string; creatorId: string; addedAt: string; creator: Creator | null; }
interface SavedList { id: string; name: string; items: ListItem[]; }
interface ConfirmDialog { title: string; body: string; onConfirm: () => void; confirmLabel?: string; danger?: boolean; }
interface Toast { id: number; msg: string; type: "success" | "error" | "info"; }

let toastCounter = 0;

function fmtNum(n: string | null): string {
  if (!n) return "—";
  const num = parseInt(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function displayName(c: Creator): string {
  return c.fullName || [c.firstName].filter(Boolean).join(" ") || c.username || "—";
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmModal({ dialog, onClose }: { dialog: ConfirmDialog; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-6 w-[360px] shadow-2xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          {dialog.danger && (
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(239,68,68,0.15)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="w-5 h-5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
          )}
          <div className="flex-1">
            <h3 className="font-semibold text-base mb-1" style={{ color: "var(--text-primary)" }}>{dialog.title}</h3>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{dialog.body}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => { dialog.onConfirm(); onClose(); }}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: dialog.danger ? "#ef4444" : "var(--accent)", color: "white" }}
          >
            {dialog.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="flex items-center gap-3 px-5 py-3 rounded-full text-sm font-medium shadow-2xl pointer-events-auto"
          style={{
            background: t.type === "error" ? "#ef4444" : t.type === "info" ? "var(--surface-2)" : "var(--accent)",
            color: "white",
            border: t.type === "info" ? "1px solid var(--border)" : "none",
            animation: "slideUp 0.2s ease",
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function ListPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listId = searchParams.get("id");

  const [list, setList] = useState<SavedList | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [exporting, setExporting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deletingList, setDeletingList] = useState(false);

  function showToast(msg: string, type: Toast["type"] = "success") {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }

  function confirm(dialog: ConfirmDialog) {
    setConfirmDialog(dialog);
  }

  async function fetchList() {
    if (!listId) return;
    const res = await fetch(`/api/lists/${listId}`);
    if (res.status === 401) { router.push("/login"); return; }
    if (!res.ok) { router.push("/dashboard"); return; }
    const data = await res.json();
    setList(data.list);
    setNewName(data.list.name);
    setLoading(false);
  }

  useEffect(() => { fetchList(); }, [listId]);

  // ── Rename (optimistic, instant) ──────────────────────────────────────────
  function saveRename() {
    if (!listId || !list) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (trimmed === list.name) { setEditingName(false); return; }

    confirm({
      title: "Rename list",
      body: `Rename "${list.name}" to "${trimmed}"?`,
      confirmLabel: "Rename",
      onConfirm: () => {
        const previousName = list.name;
        // Update instantly, don't wait on the network
        setList({ ...list, name: trimmed });
        setEditingName(false);
        setSavingName(true);

        fetch(`/api/lists/${listId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        })
          .then(res => {
            if (!res.ok) throw new Error();
            showToast("List renamed");
          })
          .catch(() => {
            setList(prev => prev ? { ...prev, name: previousName } : prev);
            setNewName(previousName);
            showToast("Failed to rename list", "error");
          })
          .finally(() => setSavingName(false));
      },
    });
  }

  // ── Remove creator (optimistic, instant) ──────────────────────────────────
  function handleRemoveCreator(item: ListItem) {
    if (!listId || !list) return;
    const c = item.creator;
    const label = c?.username ? `@${c.username}` : "this creator";

    confirm({
      title: "Remove creator",
      body: `Remove ${label} from "${list.name}"? You can add them again later from search.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: () => {
        const creatorId = item.creatorId;
        setRemovingId(item.id);
        // Remove instantly from the UI
        setList(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== item.id) } : prev);

        fetch(`/api/lists/${listId}/items?creatorId=${encodeURIComponent(creatorId)}`, {
          method: "DELETE",
        })
          .then(res => {
            if (!res.ok) throw new Error();
            showToast("Creator removed");
          })
          .catch(() => {
            setList(prev => prev ? { ...prev, items: [...prev.items, item] } : prev);
            showToast("Failed to remove creator", "error");
          })
          .finally(() => setRemovingId(null));
      },
    });
  }

  // ── Delete list ────────────────────────────────────────────────────────────
  function handleDeleteList() {
    if (!listId || !list) return;
    confirm({
      title: "Delete list",
      body: `"${list.name}" and all its creators will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete list",
      danger: true,
      onConfirm: () => {
        setDeletingList(true);
        fetch(`/api/lists/${listId}`, { method: "DELETE" })
          .then(res => {
            if (!res.ok) throw new Error();
            router.push("/dashboard");
          })
          .catch(() => {
            showToast("Failed to delete list", "error");
            setDeletingList(false);
          });
      },
    });
  }

  async function exportCSV() {
    if (!listId) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/lists/${listId}/export`);
      if (!res.ok) { showToast("Export failed", "error"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${list?.name || "list"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("CSV downloaded");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
      <span style={{ color: "var(--text-secondary)" }}>Loading…</span>
    </div>
  );

  if (!list) return null;

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <style>{`
        @keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center gap-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
          Dashboard
        </button>
        <span style={{ color: "var(--border)" }}>·</span>

        {/* Editable name */}
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") { setEditingName(false); setNewName(list.name); } }}
              autoFocus
              className="px-3 py-1 rounded-lg text-sm font-semibold outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--accent)", color: "var(--text-primary)", minWidth: "200px" }}
            />
            <button onClick={saveRename} disabled={savingName} className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-50" style={{ background: "var(--accent)", color: "white" }}>
              {savingName ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditingName(false); setNewName(list.name); }} className="px-3 py-1 rounded-lg text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="font-semibold">{list.name}</h1>
            <button onClick={() => setEditingName(true)} style={{ color: "var(--text-secondary)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
        )}

        <span className="text-sm ml-1" style={{ color: "var(--text-secondary)" }}>{list.items.length} creators</span>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportCSV}
            disabled={exporting || list.items.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          <button
            onClick={handleDeleteList}
            disabled={deletingList}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            {deletingList ? "Deleting…" : "Delete list"}
          </button>
        </div>
      </div>

      {/* Creators table */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {list.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "var(--surface)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8" style={{ color: "var(--text-secondary)" }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3 className="font-medium mb-1">No creators in this list</h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>Go to search and add creators using the + List button</p>
            <button onClick={() => router.push("/dashboard")} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--accent)", color: "white" }}>
              Go to search
            </button>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                  {["Creator", "Niche", "Followers", "Location", "Gender", "Status", "Added", ""].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.items.filter(item => item.creator !== null).map(item => {
                  const c = item.creator as Creator;
                  return (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", opacity: removingId === item.id ? 0.4 : 1 }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {c.profilePicture ? (
                            <img src={c.profilePicture} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium" style={{ background: "var(--accent)", color: "white" }}>
                              {(c.username || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate">{c.username || "—"}</p>
                            <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{displayName(c)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {c.nichePrimary && (
                          <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>{c.nichePrimary}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{fmtNum(c.followerCount)}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {[c.addressCity, c.addressCountry].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs capitalize" style={{ color: "var(--text-secondary)" }}>{c.gender || "—"}</td>
                      <td className="px-4 py-3">
                        {c.collaborationStatus && (
                          <span className="px-2 py-0.5 rounded-full text-xs capitalize" style={{
                            background: ["open","active"].includes(c.collaborationStatus.toLowerCase()) ? "rgba(34,197,94,0.15)" : "var(--surface-2)",
                            color: ["open","active"].includes(c.collaborationStatus.toLowerCase()) ? "#22c55e" : "var(--text-secondary)",
                          }}>{c.collaborationStatus}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {new Date(item.addedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => c.username && router.push(`/dashboard/creators/${c.username}`)}
                            className="px-2 py-1 rounded text-xs"
                            style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleRemoveCreator(item)}
                            disabled={removingId === item.id}
                            className="px-2 py-1 rounded text-xs font-medium disabled:opacity-50"
                            style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ToastStack toasts={toasts} />
      {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
    </div>
  );
}

export default function ListPage() {
  return (
    <Suspense>
      <ListPageInner />
    </Suspense>
  );
}