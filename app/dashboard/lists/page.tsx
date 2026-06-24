"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cachedFetch, invalidateCache } from "@/lib/client-cache";
import toast, { Toaster } from "react-hot-toast";
import Link from "next/link";

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
interface SavedListSummary { id: string; name: string; _count: { items: number }; }
interface ConfirmDialog { title: string; body: string; onConfirm: () => void; confirmLabel?: string; danger?: boolean; }

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
        <div className="flex items-start gap-3 mb-5">
          {dialog.danger && (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.15)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="w-5 h-5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
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
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
          >
            Cancel
          </button>
          <button
            onClick={() => { dialog.onConfirm(); onClose(); }}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ background: dialog.danger ? "#ef4444" : "var(--accent)", color: "white" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
          >
            {dialog.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ListPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listId = searchParams.get("id");

  const [list, setList] = useState<SavedList | null>(null);
  const [allLists, setAllLists] = useState<SavedListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [exporting, setExporting] = useState(false);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [deletingList, setDeletingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRemoving, setBulkRemoving] = useState(false);

  function confirm(dialog: ConfirmDialog) { setConfirmDialog(dialog); }

  async function fetchList() {
    if (!listId) return;
    try {
      const res = await fetch(`/api/lists/${listId}`);
      if (res.status === 401) { 
        toast.error("Session expired. Please login again.");
        router.push("/login"); 
        return; 
      }
      if (!res.ok) { 
        toast.error("List not found");
        router.push("/dashboard"); 
        return; 
      }
      const data = await res.json();
      setList(data.list);
      setNewName(data.list.name);
    } catch (error) {
      console.error("Error fetching list:", error);
      toast.error("Failed to load list");
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function fetchAllLists() {
    try {
      const data = await cachedFetch("lists", () =>
        fetch("/api/lists").then(r => r.ok ? r.json() : { lists: [] })
      );
      setAllLists(data.lists || []);
    } catch (error) {
      console.error("Error fetching lists:", error);
      // non-critical, sidebar just stays empty
    }
  }

  useEffect(() => {
    fetchList();
    fetchAllLists();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  function goBackToDashboard() {
    try { sessionStorage.setItem("lists_sidebar_open", "true"); } catch {}
    router.push("/dashboard");
  }

  function openList(id: string) {
    router.push(`/dashboard/lists?id=${id}`);
  }

  async function createList() {
    if (!newListName.trim() || creatingList) return;
    const trimmed = newListName.trim();
    
    // Check for duplicate list names (case-insensitive)
    const duplicate = allLists.some(l => l.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) { 
      toast.error(`A list named "${trimmed}" already exists`); 
      return; 
    }
    
    setCreatingList(true);
    const toastId = toast.loading("Creating list...");
    
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      
      if (!res.ok) {
        // Check if the API returned a duplicate error
        const errorData = await res.json().catch(() => ({}));
        if (errorData.error && errorData.error.toLowerCase().includes("already exists")) {
          toast.error(`A list named "${trimmed}" already exists`, { id: toastId });
          setCreatingList(false);
          return;
        }
        throw new Error("Failed to create list");
      }
      
      setNewListName("");
      invalidateCache("lists");
      await fetchAllLists();
      toast.success("List created successfully", { id: toastId });
    } catch (error) {
      console.error("Error creating list:", error);
      toast.error("Failed to create list", { id: toastId });
    } finally {
      setCreatingList(false);
    }
  }

  function saveRename() {
    if (!listId || !list) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (trimmed === list.name) { setEditingName(false); return; }

    // Check for duplicate names when renaming (excluding the current list)
    const duplicate = allLists.some(l => l.id !== listId && l.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      toast.error(`A list named "${trimmed}" already exists`);
      return;
    }

    confirm({
      title: "Rename list",
      body: `Rename "${list.name}" to "${trimmed}"?`,
      confirmLabel: "Rename",
      onConfirm: () => {
        const previousName = list.name;
        setList({ ...list, name: trimmed });
        setEditingName(false);
        setSavingName(true);

        const toastId = toast.loading("Renaming list...");
        fetch(`/api/lists/${listId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        })
          .then(res => {
            if (!res.ok) throw new Error("Failed to rename list");
            toast.dismiss(toastId);
            toast.success("List renamed successfully");
            invalidateCache("lists");
            fetchAllLists();
          })
          .catch((error) => {
            console.error("Error renaming list:", error);
            toast.dismiss(toastId);
            toast.error("Failed to rename list");
            setList(prev => prev ? { ...prev, name: previousName } : prev);
            setNewName(previousName);
          })
          .finally(() => setSavingName(false));
      },
    });
  }

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
        setRemovingIds(prev => new Set([...prev, item.id]));
        setList(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== item.id) } : prev);
        setSelectedIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });

        const toastId = toast.loading("Removing creator...");
        fetch(`/api/lists/${listId}/items?creatorId=${encodeURIComponent(creatorId)}`, { method: "DELETE" })
          .then(res => {
            if (!res.ok) throw new Error("Failed to remove creator");
            toast.dismiss(toastId);
            toast.success("Creator removed successfully");
            invalidateCache("lists");
            fetchAllLists();
          })
          .catch((error) => {
            console.error("Error removing creator:", error);
            toast.dismiss(toastId);
            toast.error("Failed to remove creator");
            // Restore the item
            setList(prev => prev ? { ...prev, items: [...prev.items, item] } : prev);
          })
          .finally(() => setRemovingIds(prev => { const n = new Set(prev); n.delete(item.id); return n; }));
      },
    });
  }

  function handleBulkRemove() {
    if (!listId || !list || selectedIds.size === 0) return;
    const count = selectedIds.size;

    confirm({
      title: `Remove ${count} creator${count !== 1 ? "s" : ""}`,
      body: `Remove ${count} selected creator${count !== 1 ? "s" : ""} from "${list.name}"? You can add them again later from search.`,
      confirmLabel: `Remove ${count}`,
      danger: true,
      onConfirm: async () => {
        setBulkRemoving(true);
        const itemsToRemove = list.items.filter(i => selectedIds.has(i.id));
        const itemIds = itemsToRemove.map(i => i.id);

        // Optimistically remove from UI
        setList(prev => prev ? { ...prev, items: prev.items.filter(i => !selectedIds.has(i.id)) } : prev);
        setSelectedIds(new Set());

        const toastId = toast.loading(`Removing ${count} creator${count !== 1 ? "s" : ""}…`);
        let failed = 0;
        try {
          await Promise.all(
            itemsToRemove.map(async (item) => {
              try {
                const res = await fetch(`/api/lists/${listId}/items?creatorId=${encodeURIComponent(item.creatorId)}`, { method: "DELETE" });
                if (!res.ok) throw new Error();
              } catch {
                failed++;
              }
            })
          );

          if (failed > 0) {
            // Restore failed items
            const failedItems = itemsToRemove.slice(0, failed);
            setList(prev => prev ? { ...prev, items: [...prev.items, ...failedItems] } : prev);
            toast.error(`${failed} creator${failed !== 1 ? "s" : ""} could not be removed`, { id: toastId });
          } else {
            toast.success(`${count} creator${count !== 1 ? "s" : ""} removed successfully`, { id: toastId });
          }

          invalidateCache("lists");
          fetchAllLists();
        } catch (error) {
          console.error("Error in bulk remove:", error);
          toast.error("An error occurred during removal", { id: toastId });
          // Restore all items
          setList(prev => prev ? { ...prev, items: [...prev.items, ...itemsToRemove] } : prev);
        } finally {
          setBulkRemoving(false);
          setRemovingIds(prev => { const n = new Set(prev); itemIds.forEach(id => n.delete(id)); return n; });
        }
      },
    });
  }

  function handleDeleteList() {
    if (!listId || !list) return;
    confirm({
      title: "Delete list",
      body: `"${list.name}" and all its creators will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete list",
      danger: true,
      onConfirm: () => {
        setDeletingList(true);
        const toastId = toast.loading("Deleting list...");
        fetch(`/api/lists/${listId}`, { method: "DELETE" })
          .then(res => {
            if (!res.ok) throw new Error("Failed to delete list");
            toast.dismiss(toastId);
            toast.success("List deleted successfully");
            // Clear session storage to prevent stale list name
            try { sessionStorage.removeItem("lists_sidebar_open"); } catch {}
            // Navigate back to dashboard
            goBackToDashboard();
          })
          .catch((error) => {
            console.error("Error deleting list:", error);
            toast.dismiss(toastId);
            toast.error("Failed to delete list");
            setDeletingList(false);
          });
      },
    });
  }

  async function exportCSV() {
    if (!listId) return;
    setExporting(true);
    const toastId = toast.loading("Exporting...");
    try {
      const res = await fetch(`/api/lists/${listId}/export`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${list?.name || "list"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded successfully", { id: toastId });
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Export failed", { id: toastId });
    } finally {
      setExporting(false);
    }
  }

  // Multi-select helpers
  const visibleItems = list?.items.filter(item => item.creator !== null) ?? [];
  const allSelected = visibleItems.length > 0 && visibleItems.every(i => selectedIds.has(i.id));
  const someSelected = selectedIds.size > 0;

  function toggleItem(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleItems.map(i => i.id)));
    }
  }

  // ─── Loading state ────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
      <span className="flex items-center gap-2.5 text-sm" style={{ color: "var(--text-secondary)" }}>
        <svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        Loading list…
      </span>
    </div>
  );

  if (!list) return null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)" }}>
      <style>{`
        @keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 0.7s linear infinite; }
        * { -webkit-user-select: none; user-select: none; }
        input, textarea { -webkit-user-select: text; user-select: text; }
        .row-hover:hover { background: var(--surface-2) !important; }
        .nav-item-hover:hover { background: var(--surface-2) !important; color: var(--text-primary) !important; }
        .btn-ghost-hover:hover { background: var(--surface-2) !important; color: var(--text-primary) !important; }
        .btn-danger-hover:hover { background: rgba(239,68,68,0.08) !important; color: #ef4444 !important; }
      `}</style>

      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-4 h-4">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <span className="font-semibold text-sm truncate">CreatorDiscover</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {/* Search nav item */}
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm nav-item-hover"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            Search
          </Link>

          {/* Saved Lists — always expanded on this page */}
          <div>
            <div
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium"
              style={{ color: "var(--accent)", background: "rgba(99,102,241,0.1)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              Saved Lists
              {allLists.length > 0 && (
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  {allLists.length}
                </span>
              )}
            </div>

            <div className="mt-1 ml-3 space-y-0.5">
              {allLists.map(l => (
                <button
                  key={l.id}
                  onClick={() => openList(l.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-left"
                  style={{
                    color: l.id === listId ? "var(--accent)" : "var(--text-secondary)",
                    background: l.id === listId ? "rgba(99,102,241,0.1)" : "transparent",
                    fontWeight: l.id === listId ? 600 : 400,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={e => { if (l.id !== listId) { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; } }}
                  onMouseLeave={e => { if (l.id !== listId) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; } }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 flex-shrink-0" style={{ color: l.id === listId ? "var(--accent)" : "currentColor" }}>
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span className="flex-1 truncate">{l.name}</span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--surface)", color: "var(--text-secondary)", minWidth: "1.5rem", textAlign: "center" }}
                  >
                    {l._count.items}
                  </span>
                </button>
              ))}

              {/* New list input */}
              <div className="flex gap-1.5 px-1 pt-2 pb-1">
                <input
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createList()}
                  placeholder="New list…"
                  disabled={creatingList}
                  className="flex-1 px-2 py-1.5 rounded-xl text-xs outline-none disabled:opacity-50"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
                <button
                  onClick={createList}
                  disabled={!newListName.trim() || creatingList}
                  className="px-2 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40 flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--accent)", color: "white", minWidth: "1.75rem" }}
                >
                  {creatingList
                    ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                    : "+"
                  }
                </button>
              </div>
            </div>
          </div>
        </nav>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center gap-3 flex-wrap" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          {/* Back button */}
          <button
            onClick={goBackToDashboard}
            className="flex items-center gap-1.5 text-sm btn-ghost-hover px-2 py-1 rounded-lg"
            style={{ color: "var(--text-secondary)", transition: "background 0.12s, color 0.12s" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Dashboard
          </button>

          <span style={{ color: "var(--border)" }}>·</span>

          {/* Editable list name */}
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") saveRename();
                  if (e.key === "Escape") { setEditingName(false); setNewName(list.name); }
                }}
                autoFocus
                className="px-3 py-1.5 rounded-xl text-sm font-semibold outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--accent)", color: "var(--text-primary)", minWidth: "200px" }}
              />
              <button
                onClick={saveRename}
                disabled={savingName}
                className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-50 flex items-center gap-1.5"
                style={{ background: "var(--accent)", color: "white" }}
              >
                {savingName && <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>}
                {savingName ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditingName(false); setNewName(list.name); }}
                className="px-3 py-1.5 rounded-xl text-xs btn-ghost-hover"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)", transition: "background 0.12s, color 0.12s" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="font-semibold" style={{ color: "var(--text-primary)" }}>{list.name}</h1>
              <button
                onClick={() => setEditingName(true)}
                className="p-1 rounded-lg btn-ghost-hover flex-shrink-0"
                style={{ color: "var(--text-secondary)", transition: "background 0.12s, color 0.12s" }}
                title="Rename list"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
          )}

          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{list.items.length} creator{list.items.length !== 1 ? "s" : ""}</span>

          {/* Bulk remove button */}
          {someSelected && (
            <button
              onClick={handleBulkRemove}
              disabled={bulkRemoving}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium disabled:opacity-50 btn-danger-hover"
              style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", transition: "background 0.12s, color 0.12s" }}
            >
              {bulkRemoving
                ? <svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              }
              Remove {selectedIds.size}
            </button>
          )}

          {/* Spacer */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={exportCSV}
              disabled={exporting || list.items.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--accent)", color: "white", transition: "opacity 0.12s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            >
              {exporting
                ? <><svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Exporting…</>
                : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export CSV</>
              }
            </button>
            <button
              onClick={handleDeleteList}
              disabled={deletingList}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 btn-danger-hover"
              style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", transition: "background 0.12s, color 0.12s" }}
            >
              {deletingList
                ? <><svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Deleting…</>
                : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete list</>
              }
            </button>
          </div>
        </div>

        {/* Creator table */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8">
            {list.items.length === 0 ? (
              /* ── Empty state ── */
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8" style={{ color: "var(--text-secondary)" }}>
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <h3 className="font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>No creators in this list</h3>
                <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Go to search and add creators using the + List button</p>
                <button
                  onClick={goBackToDashboard}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: "var(--accent)", color: "white", transition: "opacity 0.12s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                >
                  Go to search
                </button>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                      {/* Select-all checkbox */}
                      <th className="px-4 py-3 w-10">
                        <button
                          onClick={toggleAll}
                          className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                          style={{
                            borderColor: allSelected ? "var(--accent)" : "var(--border)",
                            background: allSelected ? "var(--accent)" : "transparent",
                          }}
                          title={allSelected ? "Deselect all" : "Select all"}
                        >
                          {allSelected && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" className="w-2.5 h-2.5">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </button>
                      </th>
                      {["Creator", "Niche", "Followers", "Location", "Gender", "Collab Status", "Added", "Actions"].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map(item => {
                      const c = item.creator as Creator;
                      const isSelected = selectedIds.has(item.id);
                      const isRemoving = removingIds.has(item.id);
                      return (
                        <tr
                          key={item.id}
                          className="row-hover"
                          style={{
                            borderBottom: "1px solid var(--border)",
                            background: isSelected ? "rgba(99,102,241,0.06)" : "var(--surface)",
                            opacity: isRemoving ? 0.4 : 1,
                            transition: "opacity 0.15s, background 0.1s",
                          }}
                        >
                          {/* Row checkbox */}
                          <td className="px-4 py-3 w-10">
                            <button
                              onClick={() => toggleItem(item.id)}
                              className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                              style={{
                                borderColor: isSelected ? "var(--accent)" : "var(--border)",
                                background: isSelected ? "var(--accent)" : "transparent",
                              }}
                            >
                              {isSelected && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" className="w-2.5 h-2.5">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </button>
                          </td>

                          {/* Creator */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {c.profilePicture ? (
                                <img
                                  src={c.profilePicture}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : (
                                <div
                                  className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium"
                                  style={{ background: "var(--accent)", color: "white" }}
                                >
                                  {(c.username || "?").charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium truncate" style={{ color: "var(--text-primary)" }}>{c.username || "—"}</p>
                                <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{displayName(c)}</p>
                              </div>
                            </div>
                          </td>

                          {/* Niche — always reserve height so rows don't shrink */}
                          <td className="px-4 py-3" style={{ minHeight: "52px" }}>
                            <div style={{ minHeight: "22px" }}>
                              {c.nichePrimary && (
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs whitespace-nowrap"
                                  style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}
                                >
                                  {c.nichePrimary}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Followers */}
                          <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>{fmtNum(c.followerCount)}</td>

                          {/* Location */}
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {[c.addressCity, c.addressCountry].filter(Boolean).join(", ") || "—"}
                          </td>

                          {/* Gender */}
                          <td className="px-4 py-3 text-xs capitalize" style={{ color: "var(--text-secondary)" }}>
                            {c.gender || "—"}
                          </td>

                          {/* Collab status — always reserve height */}
                          <td className="px-4 py-3">
                            <div style={{ minHeight: "22px" }}>
                              {c.collaborationStatus && (
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs capitalize whitespace-nowrap"
                                  style={{
                                    background: ["open", "active"].includes(c.collaborationStatus.toLowerCase()) ? "rgba(34,197,94,0.15)" : "var(--surface-2)",
                                    color: ["open", "active"].includes(c.collaborationStatus.toLowerCase()) ? "#22c55e" : "var(--text-secondary)",
                                  }}
                                >
                                  {c.collaborationStatus}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Added date */}
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {new Date(item.addedAt).toLocaleDateString()}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => c.username && router.push(`/dashboard/creators/${c.username}`)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium btn-ghost-hover"
                                style={{
                                  background: "var(--surface-2)",
                                  color: "var(--text-secondary)",
                                  border: "1px solid var(--border)",
                                  transition: "background 0.12s, color 0.12s",
                                }}
                              >
                                View
                              </button>
                              <button
                                onClick={() => handleRemoveCreator(item)}
                                disabled={isRemoving}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 btn-danger-hover"
                                style={{
                                  background: "rgba(239,68,68,0.08)",
                                  color: "#ef4444",
                                  border: "1px solid rgba(239,68,68,0.18)",
                                  transition: "background 0.12s, color 0.12s",
                                }}
                              >
                                {isRemoving ? "…" : "Remove"}
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
        </div>
      </div>

      {/* react-hot-toast portal */}
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: "var(--surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "9999px",
            fontSize: "0.875rem",
            fontWeight: 500,
            padding: "10px 18px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          },
          success: { iconTheme: { primary: "var(--accent)", secondary: "white" } },
          error: { iconTheme: { primary: "#ef4444", secondary: "white" } },
        }}
      />

      {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
    </div>
  );
}

export default function ListPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <span className="flex items-center gap-2.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          <svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10"/>
          </svg>
          Loading...
        </span>
      </div>
    }>
      <ListPageInner />
    </Suspense>
  );
}