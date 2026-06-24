"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { cachedFetch, invalidateCache, setCached } from "@/lib/client-cache";

interface User { id: string; email: string; fullName: string; role: string; }
interface SavedList { id: string; name: string; _count: { items: number }; }

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [showLists, setShowLists] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [newListName, setNewListName] = useState("");

  const isListsPage = pathname?.startsWith("/dashboard/lists") ?? false;

  const fetchLists = useCallback(() => {
    invalidateCache("lists");
    fetch("/api/lists")
      .then(r => r.ok ? r.json() : { lists: [] })
      .then(d => {
        const lists = d.lists || [];
        setCached("lists", { lists });
        setSavedLists(lists);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    cachedFetch("auth/me", () =>
      fetch("/api/auth/me").then(r => r.ok ? r.json() : null)
    ).then(d => { if (d?.user) setUser(d.user); }).catch(() => {});

    cachedFetch<{ lists: SavedList[] }>("lists", () =>
      fetch("/api/lists").then(r => r.ok ? r.json() : { lists: [] })
    ).then(d => setSavedLists(d?.lists || [])).catch(() => {});

    const handler = () => fetchLists();
    window.addEventListener("lists:updated", handler);
    return () => window.removeEventListener("lists:updated", handler);
  }, [fetchLists]);

  // Auto-expand saved lists when on the lists page
  useEffect(() => {
    if (isListsPage) setShowLists(true);
  }, [isListsPage]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch {}
  }

  async function createList() {
    if (!newListName.trim()) return;
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newListName.trim() }),
    });
    if (res.ok) {
      setNewListName("");
      fetchLists();
      window.dispatchEvent(new CustomEvent("lists:updated"));
    }
  }

  function openList(id: string) {
    router.push(`/dashboard/lists?id=${id}`);
  }

  const navActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard" || (pathname?.startsWith("/dashboard/creators") ?? false);
    if (href === "/overview") return pathname === "/overview";
    if (href === "/notes") return pathname === "/notes";
    if (href === "/admin") return pathname === "/admin";
    return false;
  };

  const listsActive = showLists || isListsPage;

  function linkStyle(href: string) {
    const active = navActive(href);
    return {
      background: active ? "rgba(99,102,241,0.15)" : "transparent",
      color: active ? "var(--accent)" : "var(--text-secondary)",
    };
  }

  function onEnter(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!navActive(href)) {
      (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)";
      (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)";
    }
  }
  function onLeave(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!navActive(href)) {
      (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
      (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)";
    }
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      {/* Logo */}
      <div className="px-4 py-4 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-4 h-4">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-xs leading-tight truncate" style={{ color: "var(--text-primary)" }}>CreatorDiscover</p>
            <p className="text-xs leading-tight" style={{ color: "var(--text-secondary)" }}>Veel</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {/* Dashboard */}
        <Link href="/overview"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={linkStyle("/overview")}
          onMouseEnter={e => onEnter(e, "/overview")}
          onMouseLeave={e => onLeave(e, "/overview")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          <span>Dashboard</span>
        </Link>

        {/* Search */}
        <Link href="/dashboard"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={linkStyle("/dashboard")}
          onMouseEnter={e => onEnter(e, "/dashboard")}
          onMouseLeave={e => onLeave(e, "/dashboard")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <span>Search</span>
        </Link>

        {/* Notes */}
        <Link href="/notes"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={linkStyle("/notes")}
          onMouseEnter={e => onEnter(e, "/notes")}
          onMouseLeave={e => onLeave(e, "/notes")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <span>Notes</span>
        </Link>

        {/* Saved Lists */}
        <div>
          <button onClick={() => setShowLists(!showLists)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ color: listsActive ? "var(--accent)" : "var(--text-secondary)", background: listsActive ? "rgba(99,102,241,0.1)" : "transparent" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="flex-1 text-left">Saved Lists</span>
            {savedLists.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: listsActive ? "rgba(99,102,241,0.2)" : "var(--surface-2)", color: listsActive ? "var(--accent)" : "var(--text-secondary)" }}>
                {savedLists.length}
              </span>
            )}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={`w-3 h-3 flex-shrink-0 transition-transform duration-150 ${listsActive ? "rotate-180" : ""}`}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {listsActive && (
            <div className="mt-0.5 ml-2 pl-3 border-l space-y-0.5" style={{ borderColor: "var(--border)" }}>
              {savedLists.length === 0 ? (
                <p className="text-xs px-2 py-2" style={{ color: "var(--text-secondary)" }}>No lists yet</p>
              ) : (
                savedLists.map(list => (
                  <button key={list.id} onClick={() => openList(list.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors"
                    style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 flex-shrink-0" style={{ color: "var(--accent)", opacity: 0.7 }}>
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span className="flex-1 truncate">{list.name}</span>
                    <span className="text-xs tabular-nums px-1 py-0.5 rounded"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)", minWidth: "1.25rem", textAlign: "center" }}>
                      {list._count.items}
                    </span>
                  </button>
                ))
              )}
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

        {/* Admin — only for ADMIN role */}
        {user?.role === "ADMIN" && (
          <Link href="/admin"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={linkStyle("/admin")}
            onMouseEnter={e => onEnter(e, "/admin")}
            onMouseLeave={e => onLeave(e, "/admin")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>Admin</span>
          </Link>
        )}
      </nav>

      {/* User footer */}
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Sign out</span>
          </button>
        )}
      </div>
    </aside>
  );
}
