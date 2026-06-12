"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

interface Creator {
  pk: string;
  username: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  nichePrimary: string | null;
  nicheSecondary: string | null;
  followerCount: string | null;
  addressCountry: string | null;
  addressCity: string | null;
  gender: string | null;
  ageGroup: string | null;
  creatorSize: string | null;
  profilePicture: string | null;
  primarySocialLink: string | null;
  tiktokLink: string | null;
  youtubeLink: string | null;
  email: string | null;
  collaborationStatus: string | null;
  totalCollaborationsInRecent25: number | null;
}
interface Pagination { total: number; page: number; pageSize: number; totalPages: number; }
interface SavedList { id: string; name: string; _count: { items: number }; }
interface User { id: string; email: string; fullName: string; role: string; }
interface Toast { id: number; msg: string; type: "success" | "error" | "info"; }
interface ConfirmDialog { title: string; body: string; onConfirm: () => void; confirmLabel?: string; danger?: boolean; }

function fmtNum(n: string | number | null): string {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "string" ? parseInt(n) : n;
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function displayName(c: Creator): string {
  return c.fullName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.username || "—";
}

const CREATOR_SIZES = ["Nano-Influencer", "Micro-Influencer", "Mid-tier", "Macro-Influencer", "Mega-Influencer"];
const sizeColor: Record<string, string> = {
  "Nano-Influencer": "#22c55e",
  "Micro-Influencer": "#3b82f6",
  "Mid-tier": "#a855f7",
  "Macro-Influencer": "#f59e0b",
  "Mega-Influencer": "#ef4444",
};

// ─── Default filters ──────────────────────────────────────────────────────────
const DEFAULT_FILTERS = {
  niche: "", gender: "", ageGroup: "", country: "", city: "",
  creatorSize: "", creatorType: "", collabStatus: "",
  followersMin: "", followersMax: "",
  hasEmail: "", hasTiktok: "", hasYoutube: "",
  sortBy: "followerCount", sortOrder: "desc",
};

// ─── NLP query parser ─────────────────────────────────────────────────────────
// Parses natural language like:
//   "Germany food creators 20k+ followers female age 20-30"
// Returns { cleanQuery, extractedFilters }
function parseNaturalQuery(raw: string): { cleanQuery: string; extractedFilters: Partial<typeof DEFAULT_FILTERS> } {
  const extracted: Partial<typeof DEFAULT_FILTERS> = {};
  let tokens = raw.toLowerCase().split(/\s+/);
  const consumed = new Set<number>();

  // ── Follower range patterns ──
  // "20k+" | "20k-500k" | "20k to 500k" | "<500k" | "500k+" | "1m+"
  const parseFollowerVal = (s: string): number | null => {
    const m = s.match(/^([\d.]+)(k|m)?$/);
    if (!m) return null;
    const base = parseFloat(m[1]);
    const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
    return Math.round(base * mult);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // "20k+" or "500k+"
    const plusMatch = t.match(/^([\d.]+[km]?)\+$/);
    if (plusMatch) {
      const val = parseFollowerVal(plusMatch[1]);
      if (val !== null) { extracted.followersMin = String(val); consumed.add(i); continue; }
    }

    // "<500k"
    const ltMatch = t.match(/^<([\d.]+[km]?)$/);
    if (ltMatch) {
      const val = parseFollowerVal(ltMatch[1]);
      if (val !== null) { extracted.followersMax = String(val); consumed.add(i); continue; }
    }

    // "20k-500k" range
    const rangeMatch = t.match(/^([\d.]+[km]?)-([\d.]+[km]?)$/);
    if (rangeMatch) {
      const lo = parseFollowerVal(rangeMatch[1]);
      const hi = parseFollowerVal(rangeMatch[2]);
      // Could be age range or follower range — distinguish by magnitude
      if (lo !== null && hi !== null) {
        if (lo >= 1000 || hi >= 1000) {
          extracted.followersMin = String(lo);
          extracted.followersMax = String(hi);
          consumed.add(i); continue;
        }
      }
    }

    // followers keyword after number e.g. "20000 followers"
    if ((t === "followers" || t === "follower") && i > 0 && !consumed.has(i - 1)) {
      // already handled by plus/range; just consume the word
      consumed.add(i);
    }
  }

  // ── Age group ──
  // "age 20-30" | "20-30 age" | "age: 25-34" | "18-24"
  const ageKeywordIdx = tokens.findIndex(t => t === "age" || t === "age:");
  if (ageKeywordIdx !== -1) {
    consumed.add(ageKeywordIdx);
    const next = tokens[ageKeywordIdx + 1];
    if (next) {
      const ageRange = next.replace(":", "").match(/^(\d+)-(\d+)$/);
      if (ageRange) {
        const lo = parseInt(ageRange[1]);
        const hi = parseInt(ageRange[2]);
        // Map to available age group options
        if (lo <= 18 && hi <= 24) extracted.ageGroup = "18-24";
        else if (lo >= 25 && hi <= 34) extracted.ageGroup = "25-34";
        else if (lo >= 35 && hi <= 44) extracted.ageGroup = "35-44";
        else if (lo >= 45) extracted.ageGroup = "45+";
        else if (lo >= 18 && hi <= 30) extracted.ageGroup = "18-24"; // best match
        else if (lo >= 20 && hi <= 35) extracted.ageGroup = "25-34";
        consumed.add(ageKeywordIdx + 1);
      }
    }
  }
  // standalone age ranges like "20-30" not already consumed
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const m = tokens[i].match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const lo = parseInt(m[1]);
      const hi = parseInt(m[2]);
      if (lo >= 14 && hi <= 70) {
        if (lo <= 24 && hi <= 27) extracted.ageGroup = "18-24";
        else if (lo >= 25 && hi <= 36) extracted.ageGroup = "25-34";
        else if (lo >= 35 && hi <= 46) extracted.ageGroup = "35-44";
        else if (lo >= 45) extracted.ageGroup = "45+";
        else if (lo >= 18 && hi <= 30) extracted.ageGroup = "18-24";
        else if (lo >= 20 && hi <= 35) extracted.ageGroup = "25-34";
        consumed.add(i);
      }
    }
  }

  // ── Gender ──
  const genderMap: Record<string, string> = {
    female: "female", women: "female", woman: "female", girl: "female", girls: "female",
    male: "male", men: "male", man: "male", boy: "male", boys: "male",
  };
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    if (genderMap[tokens[i]]) {
      extracted.gender = genderMap[tokens[i]];
      consumed.add(i); break;
    }
  }

  // ── Creator size ──
  const sizeKeywords: Record<string, string> = {
    nano: "Nano-Influencer", micro: "Micro-Influencer", "mid-tier": "Mid-tier",
    mid: "Mid-tier", macro: "Macro-Influencer", mega: "Mega-Influencer",
  };
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    if (sizeKeywords[tokens[i]]) {
      extracted.creatorSize = sizeKeywords[tokens[i]];
      consumed.add(i); break;
    }
  }

  // ── Collab status ──
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    if (tokens[i] === "open") { extracted.collabStatus = "open"; consumed.add(i); break; }
    if (tokens[i] === "closed") { extracted.collabStatus = "closed"; consumed.add(i); break; }
  }

  // ── Social presence ──
  const socialKeywords: Record<string, keyof typeof DEFAULT_FILTERS> = {
    tiktok: "hasTiktok", youtube: "hasYoutube", yt: "hasYoutube", email: "hasEmail",
  };
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const field = socialKeywords[tokens[i]];
    if (field) {
      (extracted as Record<string, string>)[field] = "true";
      consumed.add(i);
    }
  }

  // ── Stop words to strip ──
  const stopWords = new Set(["creators", "creator", "influencer", "influencers",
    "with", "and", "the", "in", "from", "a", "an", "of", "for", "between"]);
  for (let i = 0; i < tokens.length; i++) {
    if (stopWords.has(tokens[i])) consumed.add(i);
  }

  // ── Remaining tokens become the text search query ──
  const cleanQuery = tokens.filter((_, i) => !consumed.has(i)).join(" ").trim();

  return { cleanQuery, extractedFilters: extracted };
}

// ─── Toast system ─────────────────────────────────────────────────────────────
let toastCounter = 0;
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
          {t.type === "success" && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>}
          {t.type === "error" && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmModal({ dialog, onClose }: { dialog: ConfirmDialog; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="rounded-2xl p-6 w-[360px] shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
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
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Cancel</button>
          <button onClick={() => { dialog.onConfirm(); onClose(); }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: dialog.danger ? "#ef4444" : "var(--accent)", color: "white" }}>{dialog.confirmLabel ?? "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sign Out Modal ───────────────────────────────────────────────────────────
function SignOutModal({ onConfirm, onClose, userName }: { onConfirm: () => void; onClose: () => void; userName: string }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="rounded-2xl p-6 w-[340px] shadow-2xl text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "var(--surface-2)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7" style={{ color: "var(--text-secondary)" }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </div>
        <h3 className="font-semibold text-base mb-1" style={{ color: "var(--text-primary)" }}>Sign out?</h3>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          You&apos;ll be signed out of <span style={{ color: "var(--text-primary)" }}>{userName}</span>.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Stay</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ background: "var(--accent)", color: "white" }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

// ─── Active filter pills ──────────────────────────────────────────────────────
const FILTER_LABELS: Record<string, string> = {
  niche: "Niche", gender: "Gender", ageGroup: "Age", country: "Country", city: "City",
  creatorSize: "Size", creatorType: "Type", collabStatus: "Status",
  followersMin: "Min Followers", followersMax: "Max Followers",
  hasEmail: "Has Email", hasTiktok: "Has TikTok", hasYoutube: "Has YouTube",
};

function ActiveFilterPills({
  filters,
  onRemove,
}: {
  filters: typeof DEFAULT_FILTERS;
  onRemove: (key: string) => void;
}) {
  const active = Object.entries(filters).filter(
    ([k, v]) => !["sortBy", "sortOrder"].includes(k) && v !== ""
  );
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-6 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
      {active.map(([k, v]) => (
        <span
          key={k}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)", border: "1px solid rgba(99,102,241,0.3)" }}
        >
          {FILTER_LABELS[k] ?? k}: {k === "followersMin" || k === "followersMax" ? fmtNum(v) : v}
          <button
            onClick={() => onRemove(k)}
            className="ml-0.5 opacity-70 hover:opacity-100"
            aria-label={`Remove ${k} filter`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </span>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);

  // Raw user input in the search box
  const [rawQuery, setRawQuery] = useState("");
  // The actual text query sent to the backend (after NLP extraction)
  const [cleanQuery, setCleanQuery] = useState("");

  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showListsSidebar, setShowListsSidebar] = useState(false);
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [addToListCreator, setAddToListCreator] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);
  const [nicheOptions, setNicheOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });

  function showToast(msg: string, type: Toast["type"] = "success") {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }

  function confirm(dialog: ConfirmDialog) { setConfirmDialog(dialog); }

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => { if (!r.ok) { router.push("/login"); return null; } return r.json(); })
      .then(d => { if (d) setUser(d.user); });

    fetch("/api/lists")
      .then(r => r.ok ? r.json() : { lists: [] })
      .then(d => setSavedLists(d.lists || []));

    // Load all dropdown options from DB
    fetch("/api/creators/meta")
      .then(r => r.ok ? r.json() : { niches: [], countries: [], cities: [] })
      .then(d => {
        setNicheOptions((d.primaryniches || d.niches || []).filter(Boolean).sort());
        setCountryOptions((d.countries || []).filter(Boolean).sort());
        setCityOptions((d.cities || []).filter(Boolean).sort());
      });
  }, []);

  const fetchCreators = useCallback(async (q: string, p: number, f: typeof DEFAULT_FILTERS) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: "50",
        sortBy: f.sortBy,
        sortOrder: f.sortOrder,
      });
      if (q) params.set("q", q);
      if (f.niche) params.set("niche", f.niche);
      if (f.gender) params.set("gender", f.gender);
      if (f.ageGroup) params.set("ageGroup", f.ageGroup);
      if (f.country) params.set("country", f.country);
      if (f.city) params.set("city", f.city);
      if (f.creatorSize) params.set("creatorSize", f.creatorSize);
      if (f.creatorType) params.set("creatorType", f.creatorType);
      if (f.collabStatus) params.set("collabStatus", f.collabStatus);
      if (f.followersMin) params.set("followersMin", f.followersMin);
      if (f.followersMax) params.set("followersMax", f.followersMax);
      if (f.hasEmail) params.set("hasEmail", f.hasEmail);
      if (f.hasTiktok) params.set("hasTiktok", f.hasTiktok);
      if (f.hasYoutube) params.set("hasYoutube", f.hasYoutube);

      const res = await fetch(`/api/creators?${params}`);
      if (res.status === 401) { router.push("/login"); return; }
      if (!res.ok) { showToast("Failed to load creators", "error"); return; }
      const data = await res.json();
      setCreators(data.creators || []);
      setPagination(data.pagination || null);
    } finally { setLoading(false); }
  }, [router]);

  // Parse NLP from rawQuery and merge into filters, then debounce fetch
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const { cleanQuery: cq, extractedFilters } = parseNaturalQuery(rawQuery);
      setCleanQuery(cq);
      const mergedFilters = { ...filters, ...extractedFilters };
      // Only update filter state if NLP extracted something new
      if (Object.keys(extractedFilters).length > 0) {
        setFilters(prev => ({ ...prev, ...extractedFilters }));
      }
      setPage(1);
      fetchCreators(cq, 1, mergedFilters);
    }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawQuery]);

  // Re-fetch when manual filters change (not driven by NLP)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const { cleanQuery: cq } = parseNaturalQuery(rawQuery);
      setPage(1);
      fetchCreators(cq, 1, filters);
    }, 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => { fetchCreators(cleanQuery, page, filters); }, [page]); // eslint-disable-line

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function refreshLists() {
    fetch("/api/lists").then(r => r.json()).then(d => setSavedLists(d.lists || []));
  }

  async function createList() {
    if (!newListName.trim()) return;
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newListName.trim() }),
    });
    if (res.ok) { setNewListName(""); refreshLists(); showToast("List created"); }
    else showToast("Failed to create list", "error");
  }

  async function addToList(listId: string, creatorId: string) {
    const res = await fetch(`/api/lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creatorId }),
    });
    if (res.ok) { showToast("Creator added to list"); setAddToListCreator(null); refreshLists(); }
    else if (res.status === 409) { showToast("Already in this list", "info"); setAddToListCreator(null); }
    else showToast("Failed to add to list", "error");
  }

  function handleDeleteList(id: string, name: string) {
    confirm({
      title: "Delete list",
      body: `"${name}" and all its creators will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete list",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
        if (res.ok) { refreshLists(); showToast("List deleted"); }
        else showToast("Failed to delete list", "error");
      },
    });
  }

  function clearAllFilters() {
    setFilters({ ...DEFAULT_FILTERS });
    setRawQuery("");
    setCleanQuery("");
  }

  function removeFilter(key: string) {
    setFilters(prev => ({ ...prev, [key]: "" }));
  }

  const activeFiltersCount = Object.entries(filters).filter(
    ([k, v]) => !["sortBy", "sortOrder"].includes(k) && v !== ""
  ).length;

  const inputStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const selectStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  return (
    <>
      <style>{`
        @keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        select option { background: #1f2937; color: #f9fafb; }
      `}</style>

      <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)" }}>

        {/* ── Sidebar ── */}
        <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="p-5 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <span className="font-semibold text-sm">CreatorDiscover</span>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            <a href="/dashboard" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              Search
            </a>
            <button
              onClick={() => setShowListsSidebar(!showListsSidebar)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
              style={{ color: showListsSidebar ? "var(--accent)" : "var(--text-secondary)", background: showListsSidebar ? "rgba(99,102,241,0.1)" : "transparent" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              Saved Lists
              {savedLists.length > 0 && <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>{savedLists.length}</span>}
            </button>
            {user?.role === "ADMIN" && (
              <a href="/admin" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm" style={{ color: "var(--text-secondary)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Admin
              </a>
            )}
          </nav>
          <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="px-3 py-2 mb-1">
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{user?.fullName}</p>
              <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{user?.email}</p>
            </div>
            <button
              onClick={() => setShowSignOut(true)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign out
            </button>
          </div>
        </aside>

        {/* ── Lists panel ── */}
        {showListsSidebar && (
          <div className="w-72 flex-shrink-0 flex flex-col border-r overflow-y-auto" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <h2 className="font-semibold text-sm">Saved Lists</h2>
              <button onClick={() => setShowListsSidebar(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{ color: "var(--text-secondary)", background: "var(--surface-2)" }}>✕</button>
            </div>
            <div className="p-3 space-y-1 flex-1">
              {savedLists.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No lists yet</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>Create one below to get started</p>
                </div>
              )}
              {savedLists.map(list => (
                <div
                  key={list.id}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg group cursor-pointer"
                  style={{ background: "var(--surface-2)" }}
                  onClick={() => router.push(`/dashboard/lists?id=${list.id}`)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--accent)" }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  <span className="text-sm flex-1 truncate">{list.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface)", color: "var(--text-secondary)" }}>{list._count.items}</span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteList(list.id, list.name); }}
                    className="ml-4 pl-4 opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-xs font-medium transition-opacity"
                    style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}
                  >Delete</button>
                </div>
              ))}
            </div>
            <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
              <div className="flex gap-2">
                <input
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createList()}
                  placeholder="New list name…"
                  className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                  style={inputStyle}
                />
                <button onClick={createList} disabled={!newListName.trim()} className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "white" }}>Create</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Main content ── */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Search bar */}
          <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-secondary)" }}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input
                  value={rawQuery}
                  onChange={e => setRawQuery(e.target.value)}
                  placeholder='Try "Germany food creators 20k+ followers female age 20-30"'
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg text-sm outline-none"
                  style={inputStyle}
                />
                {rawQuery && (
                  <button onClick={clearAllFilters} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-secondary)" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
                style={{
                  background: showFilters ? "rgba(99,102,241,0.15)" : "var(--surface-2)",
                  border: `1px solid ${showFilters ? "var(--accent)" : "var(--border)"}`,
                  color: showFilters ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Filters
                {activeFiltersCount > 0 && (
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--accent)", color: "white" }}>{activeFiltersCount}</span>
                )}
              </button>
            </div>

            {/* Filter panel */}
            {showFilters && (
              <div className="mt-4 p-4 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>

                {/* Niche — fixed: shows label text */}
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Niche</label>
                  <select value={filters.niche} onChange={e => setFilters(p => ({ ...p, niche: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="">All niches</option>
                    {nicheOptions.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* Country — dropdown from DB */}
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Country</label>
                  <select value={filters.country} onChange={e => setFilters(p => ({ ...p, country: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="">All countries</option>
                    {countryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* City — dropdown from DB (filtered by selected country if possible) */}
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>City</label>
                  <select value={filters.city} onChange={e => setFilters(p => ({ ...p, city: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="">All cities</option>
                    {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* Creator Type */}
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Creator Type</label>
                  <input
                    value={filters.creatorType}
                    onChange={e => setFilters(p => ({ ...p, creatorType: e.target.value }))}
                    placeholder="ugc, influencer…"
                    className="w-full px-3 py-1.5 rounded-lg text-sm outline-none"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Gender</label>
                  <select value={filters.gender} onChange={e => setFilters(p => ({ ...p, gender: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="">Any</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Age Group</label>
                  <select value={filters.ageGroup} onChange={e => setFilters(p => ({ ...p, ageGroup: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="">Any</option><option value="18-24">18–24</option><option value="25-34">25–34</option><option value="35-44">35–44</option><option value="45+">45+</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Creator Size</label>
                  <select value={filters.creatorSize} onChange={e => setFilters(p => ({ ...p, creatorSize: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="">Any</option>
                    {CREATOR_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Collab Status</label>
                  <select value={filters.collabStatus} onChange={e => setFilters(p => ({ ...p, collabStatus: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="">Any</option><option value="open">Open</option><option value="closed">Closed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Min Followers</label>
                  <input type="number" value={filters.followersMin} onChange={e => setFilters(p => ({ ...p, followersMin: e.target.value }))} placeholder="10000" className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Max Followers</label>
                  <input type="number" value={filters.followersMax} onChange={e => setFilters(p => ({ ...p, followersMax: e.target.value }))} placeholder="500000" className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                </div>

                {[
                  { label: "Has Email", key: "hasEmail" },
                  { label: "Has TikTok", key: "hasTiktok" },
                  { label: "Has YouTube", key: "hasYoutube" },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{f.label}</label>
                    <select value={filters[f.key as keyof typeof DEFAULT_FILTERS]} onChange={e => setFilters(p => ({ ...p, [f.key]: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                      <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
                    </select>
                  </div>
                ))}

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Sort By</label>
                  <select value={filters.sortBy} onChange={e => setFilters(p => ({ ...p, sortBy: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="followerCount">Followers</option>
                    <option value="username">Username</option>
                    <option value="lastUpdated">Last Updated</option>
                    <option value="latestPostDate">Latest Post</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Order</label>
                  <select value={filters.sortOrder} onChange={e => setFilters(p => ({ ...p, sortOrder: e.target.value }))} className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
                    <option value="desc">Descending</option><option value="asc">Ascending</option>
                  </select>
                </div>

                <div className="col-span-full flex justify-end">
                  <button onClick={clearAllFilters} className="px-4 py-1.5 rounded-lg text-sm" style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                    Clear all filters
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Active filter pills */}
          <ActiveFilterPills filters={filters} onRemove={removeFilter} />

          {/* Results count */}
          <div className="px-6 py-2.5 flex items-center gap-3 text-sm" style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            {pagination && (loading ? "Searching…" : `${pagination.total.toLocaleString()} creators found`)}
          </div>

          {/* Creator cards */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="rounded-xl p-4 animate-pulse" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full" style={{ background: "var(--surface-2)" }}/>
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 rounded w-3/4" style={{ background: "var(--surface-2)" }}/>
                        <div className="h-3 rounded w-1/2" style={{ background: "var(--surface-2)" }}/>
                      </div>
                    </div>
                    <div className="h-3 rounded w-full mb-2" style={{ background: "var(--surface-2)" }}/>
                    <div className="h-3 rounded w-2/3" style={{ background: "var(--surface-2)" }}/>
                  </div>
                ))}
              </div>
            ) : creators.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "var(--surface)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8" style={{ color: "var(--text-secondary)" }}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                </div>
                <h3 className="font-medium mb-1">No creators found</h3>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Try adjusting your search or filters</p>
                {activeFiltersCount > 0 && (
                  <button onClick={clearAllFilters} className="mt-4 px-4 py-2 rounded-lg text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent)" }}>
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {creators.map(c => (
                  <div key={c.username || c.pk} className="rounded-xl p-4 flex flex-col gap-3 group" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div className="flex items-start gap-3">
                      {c.profilePicture ? (
                        <img src={c.profilePicture} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center font-medium text-sm" style={{ background: "var(--accent)", color: "white" }}>
                          {(c.username || c.firstName || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{c.username || "—"}</p>
                        <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{displayName(c)}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {c.nichePrimary && <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>{c.nichePrimary}</span>}
                      {c.creatorSize && <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(0,0,0,0.2)", color: sizeColor[c.creatorSize] || "var(--text-secondary)" }}>{c.creatorSize}</span>}
                      {c.addressCountry && <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>{c.addressCity ? `${c.addressCity}, ` : ""}{c.addressCountry}</span>}
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{fmtNum(c.followerCount)}</span>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>followers</span>
                      {c.gender && <span className="text-xs ml-auto capitalize" style={{ color: "var(--text-secondary)" }}>{c.gender}</span>}
                    </div>

                    {c.totalCollaborationsInRecent25 !== null && c.totalCollaborationsInRecent25 !== undefined && (
                      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        🤝 {c.totalCollaborationsInRecent25} collabs in last 25 posts
                      </div>
                    )}

                    <div className="flex gap-1.5">
                      {c.primarySocialLink && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>IG</span>}
                      {c.tiktokLink && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>TT</span>}
                      {c.youtubeLink && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>YT</span>}
                      {c.email && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>✉</span>}
                      {c.collaborationStatus && (
                        <span className="text-xs px-1.5 py-0.5 rounded ml-auto capitalize" style={{
                          background: ["open", "active"].includes(c.collaborationStatus.toLowerCase()) ? "rgba(34,197,94,0.15)" : "var(--surface-2)",
                          color: ["open", "active"].includes(c.collaborationStatus.toLowerCase()) ? "#22c55e" : "var(--text-secondary)",
                        }}>{c.collaborationStatus}</span>
                      )}
                    </div>

                    <div className="flex gap-2 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
                      <button onClick={() => c.username && router.push(`/dashboard/creators/${c.username}`)} className="flex-1 py-1.5 rounded-lg text-xs font-medium text-center" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>View details</button>
                      <button onClick={() => setAddToListCreator(c.username)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>+ List</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8 pb-4">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 rounded-lg text-sm disabled:opacity-40" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>← Previous</button>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Page {page} of {pagination.totalPages}</span>
                <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages} className="px-4 py-2 rounded-lg text-sm disabled:opacity-40" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>Next →</button>
              </div>
            )}
          </div>
        </main>

        {/* Add to list modal */}
        {addToListCreator && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setAddToListCreator(null)}>
            <div className="rounded-2xl p-6 w-80 shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Add to list</h3>
                <button onClick={() => setAddToListCreator(null)} style={{ color: "var(--text-secondary)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>Adding: <span style={{ color: "var(--text-primary)" }}>@{addToListCreator}</span></p>
              {savedLists.length === 0 ? (
                <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>No lists yet. Create one below.</p>
              ) : (
                <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                  {savedLists.map(list => (
                    <button key={list.id} onClick={() => addToList(list.id, addToListCreator!)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
                      <span className="flex-1 truncate">{list.name}</span>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{list._count.items}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createList()}
                  placeholder="Or create new list…"
                  className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                  style={inputStyle}
                />
                <button onClick={createList} className="px-3 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--accent)", color: "white" }}>Create</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
      {showSignOut && <SignOutModal onConfirm={logout} onClose={() => setShowSignOut(false)} userName={user?.email ?? ""} />}
      <ToastStack toasts={toasts} />
    </>
  );
}