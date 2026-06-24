"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "react-hot-toast";
import { cachedFetch, invalidateCache } from "@/lib/client-cache";

type Creator = {
  pk: string | null;
  username: string;
  fullName: string | null;
  nichePrimary: string | null;
  addressCountry: string | null;
  addressState: string | null;
  addressCity: string | null;
  gender: string | null;
  ageGroup: string | null;
  profilePicture: string | null;
  primarySocialLink: string | null;
  followerCount: string | null;
  creatorSize: string | null;
  isOnboarded: boolean;
  campaignNiches: string[];
  note: string | null;
  noteUpdatedAt: string | null;
};

type Pagination = { total: number; page: number; pageSize: number; totalPages: number };
type Meta = { countries: string[]; states: string[]; cities: string[]; ageGroups: string[]; genders: string[] };
type NotesResponse = { creators: Creator[]; pagination: Pagination; niches: string[] };
type User = { id: string; email: string; fullName: string; role: string };
type SavedList = { id: string; name: string; _count: { items: number } };

class UnauthorizedError extends Error {}

const EMPTY_META: Meta = { countries: [], states: [], cities: [], ageGroups: [], genders: [] };

function fmtNum(n: string | null | undefined): string {
  if (!n) return "—";
  const num = parseInt(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

const SEL: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: "0.5rem",
  padding: "0.45rem 0.75rem",
  fontSize: "0.8rem",
  outline: "none",
  minWidth: "150px",
  cursor: "pointer",
};

export default function NotesPage() {
  const router = useRouter();

  // Auth / user
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Sidebar — saved lists
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [showListsSidebar, setShowListsSidebar] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [showSignOut, setShowSignOut] = useState(false);

  // Notes data
  const [niches, setNiches] = useState<string[]>([]);
  const [selectedNiche, setSelectedNiche] = useState<string | null>(null);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [notesLoading, setNotesLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Filter values
  const [filters, setFilters] = useState({ country: "", state: "", city: "", ageGroup: "", gender: "", onboarded: "" });

  // Dropdown option lists — fetched from /api/notes/meta, cascaded
  const [metaBase, setMetaBase]     = useState<Meta>(EMPTY_META);
  const [metaStates, setMetaStates] = useState<string[]>([]);
  const [metaCities, setMetaCities] = useState<string[]>([]);

  // Multi-select deletion
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Edit modal
  const [editingCreator, setEditingCreator] = useState<Creator | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editNiches, setEditNiches] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data?.user) { router.replace("/login"); return; }
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  // ── Saved lists ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    cachedFetch<{ lists: SavedList[] }>("saved-lists", () =>
      fetch("/api/lists").then(r => r.json()),
    ).then(d => setSavedLists(d.lists ?? []));
  }, [user]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const createList = async () => {
    if (!newListName.trim()) return;
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newListName.trim() }),
    });
    if (res.ok) {
      const d = await res.json();
      setSavedLists(p => [...p, d.list]);
      invalidateCache("saved-lists");
      setNewListName("");
      toast.success("List created");
    }
  };

  // ── Notes meta — base ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    fetch("/api/notes/meta").then(r => r.json()).then(d => setMetaBase(d));
  }, [user]);

  useEffect(() => {
    if (!filters.country) { setMetaStates([]); return; }
    fetch(`/api/notes/meta?country=${encodeURIComponent(filters.country)}`).then(r => r.json()).then(d => setMetaStates(d.states));
  }, [filters.country]);

  useEffect(() => {
    if (!filters.country || !filters.state) { setMetaCities([]); return; }
    fetch(`/api/notes/meta?country=${encodeURIComponent(filters.country)}&state=${encodeURIComponent(filters.state)}`).then(r => r.json()).then(d => setMetaCities(d.cities));
  }, [filters.country, filters.state]);

  // ── Fetch notes list ──────────────────────────────────────────────────────
  const fetchNotes = useCallback(async (niche: string | null, f: typeof filters, p: number) => {
    setNotesLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: "20" });
      if (niche)      params.set("niche",    niche);
      if (f.country)  params.set("country",  f.country);
      if (f.state)    params.set("state",    f.state);
      if (f.city)     params.set("city",     f.city);
      if (f.ageGroup) params.set("ageGroup", f.ageGroup);
      if (f.gender)   params.set("gender",   f.gender);
      if (f.onboarded) params.set("onboarded", f.onboarded);

    const res = await fetch(`/api/notes?${params}`);
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(`Notes fetch failed: ${res.status}`);
    const data = await res.json();

      setCreators(data.creators ?? []);
      setPagination(data.pagination ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 });
      if (data.niches?.length) setNiches(data.niches);
    } catch (err) {
      if (err instanceof UnauthorizedError) { router.push("/login"); return; }
      toast.error("Failed to load notes");
    } finally {
      setNotesLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!loading) fetchNotes(selectedNiche, filters, page);
  }, [loading, fetchNotes, selectedNiche, filters, page]);

  function handleFilterChange(key: keyof typeof filters, val: string) {
    setFilters(prev => {
      const next = { ...prev, [key]: val };
      if (key === "country") { next.state = ""; next.city = ""; }
      if (key === "state")   { next.city = ""; }
      return next;
    });
    setPage(1);
  }

  // ── Selection helpers ─────────────────────────────────────────────────────
  function toggleSelect(username: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username); else next.add(username);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === creators.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(creators.map(c => c.username)));
    }
  }

  // ── Bulk delete — optimistic removal ─────────────────────────────────────
  async function bulkDelete() {
    if (selected.size === 0) return;
    const usernames = Array.from(selected);

    // Optimistically remove from UI immediately
    setCreators(prev => prev.filter(c => !selected.has(c.username)));
    setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - usernames.length) }));
    setSelected(new Set());
    setBulkDeleting(true);

    try {
      const results = await Promise.allSettled(
        usernames.map(u =>
          fetch(`/api/notes?username=${encodeURIComponent(u)}`, { method: "DELETE" })
        )
      );
      const failed = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
      if (failed.length > 0) {
        toast.error(`${failed.length} deletion(s) failed — refresh to see current state`);
        // Re-fetch to reconcile
        await fetchNotes(selectedNiche, filters, page);
      } else {
        toast.success(`${usernames.length} note${usernames.length !== 1 ? "s" : ""} deleted`);
        // If page is now empty and we're not on page 1, go back
        if (creators.filter(c => !usernames.includes(c.username)).length === 0 && page > 1) {
          setPage(p => p - 1);
        }
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  // ── Edit modal ────────────────────────────────────────────────────────────
  function openEdit(c: Creator) {
    setEditingCreator(c);
    setEditNote(c.note ?? "");
    setEditNiches([...c.campaignNiches]);
  }

  async function saveEdit() {
    if (!editingCreator) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes?username=${encodeURIComponent(editingCreator.username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: editNote, campaignNiches: editNiches }),
      });
      if (!res.ok) throw new Error("Save failed");
      // Optimistically update in-list
      setCreators(prev => prev.map(c =>
        c.username === editingCreator.username
          ? { ...c, note: editNote || null, campaignNiches: editNiches }
          : c
      ));
      toast.success("Note updated");
      setEditingCreator(null);
    } catch {
      toast.error("Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  const hasFilter = !!(filters.country || filters.state || filters.city || filters.ageGroup || filters.gender || filters.onboarded);
  const allSelected = creators.length > 0 && selected.size === creators.length;
  const someSelected = selected.size > 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <>
      <Toaster position="top-right" />
      <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)", color: "var(--text-primary)" }}>

        {/* ── Sidebar ── */}
        <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="px-4 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-xs leading-tight truncate" style={{ color: "var(--text-primary)" }}>CreatorDiscover</p>
                <p className="text-xs leading-tight" style={{ color: "var(--text-secondary)" }}>Veel</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            <Link href="/overview"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
              <span>Dashboard</span>
            </Link>

            <Link href="/dashboard"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <span>Search</span>
            </Link>

            <Link href="/notes"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Notes</span>
            </Link>

            <div>
              <button onClick={() => setShowListsSidebar(!showListsSidebar)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ color: showListsSidebar ? "var(--accent)" : "var(--text-secondary)", background: showListsSidebar ? "rgba(99,102,241,0.1)" : "transparent" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                <span className="flex-1 text-left">Saved Lists</span>
                {savedLists.length > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: showListsSidebar ? "rgba(99,102,241,0.2)" : "var(--surface-2)", color: showListsSidebar ? "var(--accent)" : "var(--text-secondary)" }}>
                    {savedLists.length}
                  </span>
                )}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={`w-3 h-3 flex-shrink-0 transition-transform duration-150 ${showListsSidebar ? "rotate-180" : ""}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {showListsSidebar && (
                <div className="mt-0.5 ml-2 pl-3 border-l space-y-0.5" style={{ borderColor: "var(--border)" }}>
                  {savedLists.length === 0
                    ? <p className="text-xs px-2 py-2" style={{ color: "var(--text-secondary)" }}>No lists yet</p>
                    : savedLists.map(list => (
                      <button key={list.id} onClick={() => router.push("/dashboard")}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors"
                        style={{ color: "var(--text-secondary)" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 flex-shrink-0" style={{ color: "var(--accent)", opacity: 0.7 }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        <span className="flex-1 truncate">{list.name}</span>
                        <span className="text-xs tabular-nums px-1 py-0.5 rounded"
                          style={{ background: "var(--surface-2)", color: "var(--text-secondary)", minWidth: "1.25rem", textAlign: "center" }}>
                          {list._count.items}
                        </span>
                      </button>
                    ))
                  }
                  <div className="flex gap-1.5 pt-1.5 pb-1">
                    <input value={newListName} onChange={e => setNewListName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && createList()}
                      placeholder="New list…"
                      className="flex-1 px-2 py-1 rounded-lg text-xs outline-none"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                    <button onClick={createList} disabled={!newListName.trim()}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold disabled:opacity-40 flex-shrink-0"
                      style={{ background: "var(--accent)", color: "white" }}>+</button>
                  </div>
                </div>
              )}
            </div>

            {user?.role === "ADMIN" && (
              <Link href="/admin"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Admin</span>
              </Link>
            )}
          </nav>

          <div className="p-2 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5" style={{ background: "var(--surface-2)" }}>
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
                style={{ background: "var(--accent)", color: "white" }}>
                {(user?.fullName || user?.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate leading-tight" style={{ color: "var(--text-primary)" }}>{user?.fullName || "—"}</p>
                <p className="text-xs truncate leading-tight" style={{ color: "var(--text-secondary)" }}>{user?.email}</p>
              </div>
            </div>
            {showSignOut ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-xs flex-1" style={{ color: "var(--text-secondary)" }}>Sign out?</span>
                <button onClick={handleLogout} className="text-xs font-semibold px-2 py-0.5 rounded" style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}>Yes</button>
                <button onClick={() => setShowSignOut(false)} className="text-xs px-2 py-0.5 rounded" style={{ color: "var(--text-secondary)", background: "var(--surface-2)" }}>No</button>
              </div>
            ) : (
              <button onClick={() => setShowSignOut(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>Sign out</span>
              </button>
            )}
          </div>
        </aside>

        {/* ── Niche panel ── */}
        <aside className="w-48 flex-shrink-0 border-r overflow-y-auto" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="p-3 border-b" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Niches</p>
          </div>
          <div className="p-2 space-y-0.5">
            <button
              onClick={() => { setSelectedNiche(null); setPage(1); }}
              className="w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
              style={{
                background: !selectedNiche ? "rgba(99,102,241,0.15)" : "transparent",
                color: !selectedNiche ? "var(--accent)" : "var(--text-secondary)",
                fontWeight: !selectedNiche ? 500 : 400,
              }}>
              All niches
            </button>
            {niches.map(n => (
              <button key={n}
                onClick={() => { setSelectedNiche(n); setPage(1); }}
                className="w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
                style={{
                  background: selectedNiche === n ? "rgba(99,102,241,0.15)" : "transparent",
                  color: selectedNiche === n ? "var(--accent)" : "var(--text-secondary)",
                  fontWeight: selectedNiche === n ? 500 : 400,
                }}>
                {n}
              </button>
            ))}
            {niches.length === 0 && (
              <p className="px-3 py-2 text-xs" style={{ color: "var(--text-secondary)" }}>No niches yet</p>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-6 py-3 border-b sticky top-0 z-10 flex items-center justify-between gap-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="min-w-0">
              <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                Notes{selectedNiche ? ` · ${selectedNiche}` : ""}
              </h1>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {hasFilter
                  ? `Filtered: ${[filters.country, filters.state, filters.city].filter(Boolean).join(" › ")}`
                  : "All noted creators"}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Bulk delete action bar */}
              {someSelected && (
                <button
                  onClick={bulkDelete}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
                  style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
                  {bulkDeleting
                    ? <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                  }
                  Delete {selected.size}
                </button>
              )}
              {someSelected && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs px-2 py-1.5 rounded-lg transition-colors"
                  style={{ color: "var(--text-secondary)", background: "var(--surface-2)" }}>
                  Clear
                </button>
              )}
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {pagination.total} creator{pagination.total !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Filters */}
          <div className="px-6 py-3 border-b flex gap-2 flex-wrap items-center" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <select value={filters.country} onChange={e => handleFilterChange("country", e.target.value)} style={SEL}>
              <option value="">All Countries</option>
              {metaBase.countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select
              value={filters.state}
              onChange={e => handleFilterChange("state", e.target.value)}
              disabled={!filters.country}
              style={{ ...SEL, opacity: !filters.country ? 0.45 : 1, cursor: !filters.country ? "not-allowed" : "pointer" }}>
              <option value="">All States</option>
              {metaStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <select
              value={filters.city}
              onChange={e => handleFilterChange("city", e.target.value)}
              disabled={!filters.state}
              style={{ ...SEL, opacity: !filters.state ? 0.45 : 1, cursor: !filters.state ? "not-allowed" : "pointer" }}>
              <option value="">All Cities</option>
              {metaCities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select value={filters.ageGroup} onChange={e => handleFilterChange("ageGroup", e.target.value)} style={SEL}>
              <option value="">All Age Groups</option>
              {metaBase.ageGroups.map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            <select value={filters.gender} onChange={e => handleFilterChange("gender", e.target.value)} style={SEL}>
              <option value="">All Genders</option>
              {metaBase.genders.map(g => <option key={g} value={g}>{g}</option>)}
            </select>

            <label
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs select-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={filters.onboarded === "true"}
                onChange={e => {
                  setFilters(prev => ({ ...prev, onboarded: e.target.checked ? "true" : "" }));
                  setPage(1);
                }}
                style={{ cursor: "pointer" }}
              />
              Onboarded only
            </label>

            {hasFilter && (
              <button
                onClick={() => { setFilters({ country: "", state: "", city: "", ageGroup: "", gender: "", onboarded: "" }); setPage(1); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Clear
              </button>
            )}
          </div>

          {/* Creator list */}
          <div className="flex-1 overflow-y-auto p-6">
            {notesLoading && creators.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--accent)" }} />
              </div>
            ) : creators.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No creators found</p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Add notes to creators from their profile page</p>
              </div>
            ) : (
              <>
                {/* Select-all row */}
                <div className="flex items-center gap-2 mb-3 px-1">
                  <button
                    onClick={toggleSelectAll}
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{
                      border: `2px solid ${allSelected ? "var(--accent)" : "var(--border)"}`,
                      background: allSelected ? "var(--accent)" : "transparent",
                    }}>
                    {allSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                    {!allSelected && someSelected && <div className="w-1.5 h-1.5 rounded-sm" style={{ background: "var(--accent)" }} />}
                  </button>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {someSelected ? `${selected.size} selected` : `Select all on this page`}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {creators.map(c => {
                    const idForRoute = c.username;
                    const isChecked = selected.has(c.username);
                    return (
                      <div key={idForRoute}
                        className="flex items-start gap-3 p-4 rounded-xl transition-colors group"
                        style={{
                          background: "var(--surface)",
                          border: `1px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
                          boxShadow: isChecked ? "0 0 0 3px rgba(99,102,241,0.1)" : "none",
                        }}
                        onMouseEnter={e => { if (!isChecked) e.currentTarget.style.borderColor = "var(--accent)"; }}
                        onMouseLeave={e => { if (!isChecked) e.currentTarget.style.borderColor = "var(--border)"; }}>

                        {/* Checkbox */}
                        <button
                          onClick={() => toggleSelect(c.username)}
                          className="w-4 h-4 rounded flex-shrink-0 mt-1 flex items-center justify-center transition-colors"
                          style={{
                            border: `2px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
                            background: isChecked ? "var(--accent)" : "transparent",
                          }}>
                          {isChecked && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                        </button>

                        {/* Avatar */}
                        <Link href={`/dashboard/creators/${encodeURIComponent(idForRoute)}`} className="flex-shrink-0">
                          <div className="w-12 h-12 rounded-full overflow-hidden"
                            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                            {c.profilePicture
                              ? <img src={c.profilePicture} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              : <span className="w-full h-full flex items-center justify-center text-lg font-semibold" style={{ color: "var(--text-secondary)" }}>{(c.fullName || c.username || "?")[0].toUpperCase()}</span>
                            }
                          </div>
                        </Link>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link href={`/dashboard/creators/${encodeURIComponent(idForRoute)}`}
                              className="text-sm font-semibold hover:underline" style={{ color: "var(--text-primary)" }}>
                              @{c.username}
                            </Link>
                            {c.fullName && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.fullName}</span>}
                            {c.isOnboarded && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>Onboarded</span>
                            )}
                          </div>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            {c.nichePrimary && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.nichePrimary}</span>}
                            {c.followerCount && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{fmtNum(c.followerCount)} followers</span>}
                            {c.addressCountry && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{[c.addressCity, c.addressState, c.addressCountry].filter(Boolean).join(", ")}</span>}
                            {c.gender && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.gender}</span>}
                            {c.ageGroup && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.ageGroup}</span>}
                          </div>
                          {c.campaignNiches.length > 0 && (
                            <div className="flex gap-1.5 mt-2 flex-wrap">
                              {c.campaignNiches.map(n => (
                                <span key={n} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>{n}</span>
                              ))}
                            </div>
                          )}
                          {c.note && (
                            <p className="text-xs mt-2 line-clamp-2" style={{ color: "var(--text-secondary)" }}>{c.note}</p>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(c)}
                            title="Edit note"
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button
                            onClick={async () => {
                              const u = c.username;
                              setCreators(prev => prev.filter(x => x.username !== u));
                              setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
                              setSelected(prev => { const next = new Set(prev); next.delete(u); return next; });
                              try {
                                const res = await fetch(`/api/notes?username=${encodeURIComponent(u)}`, { method: "DELETE" });
                                if (!res.ok) throw new Error();
                                toast.success("Note deleted");
                              } catch {
                                toast.error("Failed to delete — refresh to see current state");
                                await fetchNotes(selectedNiche, filters, page);
                              }
                            }}
                            title="Delete note"
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.12)"; (e.currentTarget as HTMLButtonElement).style.color = "#f87171"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg text-sm"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: page === 1 ? "var(--text-secondary)" : "var(--text-primary)", opacity: page === 1 ? 0.5 : 1 }}>
                  Previous
                </button>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{page} / {pagination.totalPages}</span>
                <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}
                  className="px-3 py-1.5 rounded-lg text-sm"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: page === pagination.totalPages ? "var(--text-secondary)" : "var(--text-primary)", opacity: page === pagination.totalPages ? 0.5 : 1 }}>
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit Note Modal ── */}
      {editingCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => !saving && setEditingCreator(null)}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>Edit note</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>@{editingCreator.username}</p>
              </div>
              {!saving && (
                <button onClick={() => setEditingCreator(null)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>

            {/* Note textarea */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--text-secondary)" }}>Note</label>
              <textarea
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
                rows={4}
                placeholder="Add a note about this creator…"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              />
            </div>

            {/* Campaign niches — dropdown from DB niches */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--text-secondary)" }}>Campaign niches</label>

              {/* Selected niche pills */}
              {editNiches.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {editNiches.map(n => (
                    <span key={n} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
                      {n}
                      <button onClick={() => setEditNiches(prev => prev.filter(x => x !== n))}
                        className="opacity-70 hover:opacity-100 ml-0.5">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Dropdown of available niches from DB */}
              {niches.filter(n => !editNiches.includes(n)).length > 0 && (
                <select
                  value=""
                  onChange={e => {
                    const v = e.target.value;
                    if (v && !editNiches.includes(v)) setEditNiches(prev => [...prev, v]);
                  }}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)", cursor: "pointer" }}>
                  <option value="">Add a niche…</option>
                  {niches.filter(n => !editNiches.includes(n)).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              )}

              {niches.length === 0 && (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>No niches available yet.</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditingCreator(null)} disabled={saving}
                className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: "var(--accent)", color: "white" }}>
                {saving && <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}