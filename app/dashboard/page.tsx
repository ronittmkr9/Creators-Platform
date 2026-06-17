"use client";
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { cachedFetch, getCached, getCacheEntry, invalidateCache, setCached } from "@/lib/client-cache";
import toast, { Toaster } from "react-hot-toast";

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
  addressState: string | null;
  gender: string | null;
  ageGroup: string | null;
  creatorSize: string | null;
  creatorType: string | null;
  profilePicture: string | null;
  primarySocialLink: string | null;
  tiktokLink: string | null;
  youtubeLink: string | null;
  email: string | null;
  collaborationStatus: string | null;
  lastUpdated: string | null;
  totalCollaborationsInRecent25: number | null;
}
interface Pagination { total: number; page: number; pageSize: number; totalPages: number; }
interface SavedList { id: string; name: string; _count: { items: number }; }
interface User { id: string; email: string; fullName: string; role: string; }
interface CreatorsMetaResponse {
  primaryniches?: string[];
  countries?: string[];
  cities?: string[];
  states?: string[];
  creatorTypes?: string[];
}
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

const DEFAULT_FILTERS = {
  niche: "", gender: "", ageGroup: "", country: "", state: "", city: "",
  creatorSize: "", creatorType: "", collabStatus: "",
  followersMin: "", followersMax: "",
  hasEmail: "", hasTiktok: "", hasYoutube: "",
  sortBy: "followerCount", sortOrder: "desc",
};

interface Lexicons {
  niches: string[];
  countries: string[];
  cities: string[];
  states: string[];
  creatorTypes: string[];
}
const EMPTY_LEXICONS: Lexicons = { niches: [], countries: [], cities: [], states: [], creatorTypes: [] };

// TTL for creator search results — after this, a background revalidation fires
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CreatorResult = { creators: Creator[]; pagination: Pagination | null };

/**
 * Builds both the cachedFetch cache key and the URLSearchParams for the API call.
 * Used by fetchCreators AND by useLayoutEffect so both always use the same key format.
 */
function buildCacheKey(q: string, p: number, f: typeof DEFAULT_FILTERS): { key: string; params: URLSearchParams } {
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
  if (f.state) params.set("state", f.state);
  if (f.city) params.set("city", f.city);
  if (f.creatorSize) params.set("creatorSize", f.creatorSize);
  if (f.creatorType) params.set("creatorType", f.creatorType);
  if (f.collabStatus) params.set("collabStatus", f.collabStatus);
  if (f.followersMin) params.set("followersMin", f.followersMin);
  if (f.followersMax) params.set("followersMax", f.followersMax);
  if (f.hasEmail) params.set("hasEmail", f.hasEmail);
  if (f.hasTiktok) params.set("hasTiktok", f.hasTiktok);
  if (f.hasYoutube) params.set("hasYoutube", f.hasYoutube);
  return { key: `creators:${params.toString()}`, params };
}

function parseNaturalQuery(raw: string, lexicons: Lexicons = EMPTY_LEXICONS): { cleanQuery: string; extractedFilters: Partial<typeof DEFAULT_FILTERS> } {
  const extracted: Partial<typeof DEFAULT_FILTERS> = {};
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const consumed = new Set<number>();

  function matchPhraseAt(start: number, candidates: string[]): { value: string; len: number } | null {
    for (let len = Math.min(4, tokens.length - start); len >= 1; len--) {
      for (let j = 0; j < len; j++) if (consumed.has(start + j)) return null;
      const phrase = tokens.slice(start, start + len).join(" ");
      const match = candidates.find(c => c.toLowerCase() === phrase);
      if (match) return { value: match, len };
    }
    return null;
  }

  function findAndConsumeLexiconMatch(candidates: string[]): string | null {
    if (candidates.length === 0) return null;
    for (let i = 0; i < tokens.length; i++) {
      if (consumed.has(i)) continue;
      const m = matchPhraseAt(i, candidates);
      if (m) {
        for (let j = 0; j < m.len; j++) consumed.add(i + j);
        return m.value;
      }
    }
    return null;
  }

  const parseFollowerVal = (s: string): number | null => {
    const m = s.match(/^([\d.]+)(k|m)?$/);
    if (!m) return null;
    const base = parseFloat(m[1]);
    const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
    return Math.round(base * mult);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const plusMatch = t.match(/^([\d.]+[km]?)\+$/);
    if (plusMatch) { const v = parseFollowerVal(plusMatch[1]); if (v !== null) { extracted.followersMin = String(v); consumed.add(i); continue; } }
    const ltMatch = t.match(/^<([\d.]+[km]?)$/);
    if (ltMatch) { const v = parseFollowerVal(ltMatch[1]); if (v !== null) { extracted.followersMax = String(v); consumed.add(i); continue; } }
    const rangeMatch = t.match(/^([\d.]+[km]?)-([\d.]+[km]?)$/);
    if (rangeMatch) {
      const lo = parseFollowerVal(rangeMatch[1]); const hi = parseFollowerVal(rangeMatch[2]);
      if (lo !== null && hi !== null && (lo >= 1000 || hi >= 1000)) { extracted.followersMin = String(lo); extracted.followersMax = String(hi); consumed.add(i); continue; }
    }
    if ((t === "followers" || t === "follower") && i > 0 && !consumed.has(i - 1)) consumed.add(i);
  }

  function ageRangeToGroup(lo: number, hi: number): string | null {
    if (lo <= 18 && hi <= 24) return "18-24";
    if (lo >= 25 && hi <= 34) return "25-34";
    if (lo >= 35 && hi <= 44) return "35-44";
    if (lo >= 45) return "45+";
    if (lo >= 18 && hi <= 30) return "18-24";
    if (lo >= 20 && hi <= 35) return "25-34";
    if (lo >= 14 && hi <= 70) {
      if (lo <= 24 && hi <= 27) return "18-24";
      if (lo >= 25 && hi <= 36) return "25-34";
      if (lo >= 35 && hi <= 46) return "35-44";
    }
    return null;
  }

  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    if (tokens[i] === "age" || tokens[i] === "ages") {
      consumed.add(i);
      let j = i + 1;
      if (tokens[j] === "group") { consumed.add(j); j++; }
      if (tokens[j] === "of") { consumed.add(j); j++; }
      const nums: number[] = []; const consumedHere: number[] = [];
      while (j < tokens.length && j < i + 6 && nums.length < 2) {
        const tok = tokens[j].replace(":", "");
        if (/^\d{1,2}-\d{1,2}$/.test(tok)) { const [lo, hi] = tok.split("-").map(Number); nums.push(lo, hi); consumedHere.push(j); break; }
        if (/^\d{1,2}$/.test(tok)) { nums.push(Number(tok)); consumedHere.push(j); j++; continue; }
        if (["between", "to", "and", "-", "through", "till", "until"].includes(tok)) { consumedHere.push(j); j++; continue; }
        if (tok.endsWith("+")) { const n = parseInt(tok); if (!isNaN(n)) { nums.push(n, 70); consumedHere.push(j); } break; }
        break;
      }
      if (nums.length >= 2) { const g = ageRangeToGroup(Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])); if (g) extracted.ageGroup = g; consumedHere.forEach(idx => consumed.add(idx)); }
      else if (nums.length === 1) { const g = ageRangeToGroup(nums[0], nums[0]); if (g) extracted.ageGroup = g; consumedHere.forEach(idx => consumed.add(idx)); }
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i) || extracted.ageGroup) continue;
    const m = tokens[i].match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) { const lo = parseInt(m[1]); const hi = parseInt(m[2]); const g = ageRangeToGroup(Math.min(lo, hi), Math.max(lo, hi)); if (g) { extracted.ageGroup = g; consumed.add(i); } }
  }

  const genderMap: Record<string, string> = { female: "female", women: "female", woman: "female", girl: "female", girls: "female", male: "male", men: "male", man: "male", boy: "male", boys: "male" };
  for (let i = 0; i < tokens.length; i++) { if (consumed.has(i)) continue; if (genderMap[tokens[i]]) { extracted.gender = genderMap[tokens[i]]; consumed.add(i); break; } }

  const sizeKeywords: Record<string, string> = { nano: "Nano-Influencer", micro: "Micro-Influencer", "mid-tier": "Mid-tier", mid: "Mid-tier", macro: "Macro-Influencer", mega: "Mega-Influencer" };
  for (let i = 0; i < tokens.length; i++) { if (consumed.has(i)) continue; if (sizeKeywords[tokens[i]]) { extracted.creatorSize = sizeKeywords[tokens[i]]; consumed.add(i); break; } }

  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    if (tokens[i] === "Active") { extracted.collabStatus = "active"; consumed.add(i); break; }
    if (tokens[i] === "Closed") { extracted.collabStatus = "closed"; consumed.add(i); break; }
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    if (consumed.has(i)) continue;
    if ((tokens[i] === "located" || tokens[i] === "based") && tokens[i + 1] === "in") { consumed.add(i); consumed.add(i + 1); }
  }

  const fieldPrefixes: Record<string, keyof typeof extracted> = { country: "country", state: "state", city: "city", niche: "niche", type: "creatorType" };
  for (let i = 0; i < tokens.length - 1; i++) {
    if (consumed.has(i)) continue;
    const key = tokens[i].replace(":", "");
    if (fieldPrefixes[key] && tokens[i + 1]) {
      consumed.add(i);
      const valTokens: string[] = []; let j = i + 1;
      while (j < tokens.length && !consumed.has(j) && valTokens.length < 3) {
        valTokens.push(tokens[j].replace(":", "")); consumed.add(j); j++;
        if (fieldPrefixes[tokens[j]]) break;
      }
      const val = valTokens.join(" "); if (val) (extracted as Record<string, string>)[fieldPrefixes[key]] = val;
    }
  }

  if (!extracted.country) { const m = findAndConsumeLexiconMatch(lexicons.countries); if (m) extracted.country = m; }
  if (!extracted.state)   { const m = findAndConsumeLexiconMatch(lexicons.states);    if (m) extracted.state = m; }
  if (!extracted.city)    { const m = findAndConsumeLexiconMatch(lexicons.cities);    if (m) extracted.city = m; }
  if (!extracted.creatorType) { const m = findAndConsumeLexiconMatch(lexicons.creatorTypes); if (m) extracted.creatorType = m; }
  if (!extracted.niche) {
    for (let i = 0; i < tokens.length - 1; i++) {
      if (consumed.has(i)) continue;
      if ((tokens[i] === "primary" || tokens[i] === "secondary") && tokens[i + 1] === "niche") {
        consumed.add(i); consumed.add(i + 1);
        const m = findAndConsumeLexiconMatch(lexicons.niches); if (m) extracted.niche = m; break;
      }
    }
    if (!extracted.niche) { const m = findAndConsumeLexiconMatch(lexicons.niches); if (m) extracted.niche = m; }
  }

  const socialKeywords: Record<string, keyof typeof DEFAULT_FILTERS> = { tiktok: "hasTiktok", youtube: "hasYoutube", yt: "hasYoutube", email: "hasEmail" };
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const field = socialKeywords[tokens[i]];
    if (field) {
      const prev = i > 0 ? tokens[i - 1] : "";
      const negated = prev === "no" || prev === "without" || prev === "not";
      (extracted as Record<string, string>)[field] = negated ? "false" : "true";
      consumed.add(i);
      if (negated && !consumed.has(i - 1)) consumed.add(i - 1);
      else if (["has", "have", "with"].includes(prev) && !consumed.has(i - 1)) consumed.add(i - 1);
    }
  }

  const stopWords = new Set(["creators", "creator", "influencer", "influencers", "with", "and", "the", "in", "from", "a", "an", "of", "for", "between", "has", "have", "is", "are", "who", "located", "based", "to"]);
  for (let i = 0; i < tokens.length; i++) { if (stopWords.has(tokens[i])) consumed.add(i); }

  const cleanQuery = tokens.filter((_, i) => !consumed.has(i)).join(" ").trim();
  return { cleanQuery, extractedFilters: extracted };
}

// ─── Toast Stack (Legacy, kept for compatibility) ──────────────────────────
let toastCounter = 0;
function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="flex items-center gap-3 px-5 py-3 rounded-full text-sm font-medium shadow-2xl pointer-events-auto"
          style={{ background: t.type === "error" ? "#ef4444" : t.type === "info" ? "var(--surface-2)" : "var(--accent)", color: "white", border: t.type === "info" ? "1px solid var(--border)" : "none", animation: "slideUp 0.2s ease" }}>
          {t.type === "success" && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>}
          {t.type === "error" && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

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

function SignOutModal({ onConfirm, onClose, userName }: { onConfirm: () => void; onClose: () => void; userName: string }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="rounded-2xl p-6 w-[340px] shadow-2xl text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "var(--surface-2)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7" style={{ color: "var(--text-secondary)" }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </div>
        <h3 className="font-semibold text-base mb-1" style={{ color: "var(--text-primary)" }}>Sign out?</h3>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>You&apos;ll be signed out of <span style={{ color: "var(--text-primary)" }}>{userName}</span>.</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Stay</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ background: "var(--accent)", color: "white" }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

function AddToListModal({
  selectedCreators, savedLists, onClose, onAddToList, onCreateList, newListName, setNewListName, addingToList,
}: {
  selectedCreators: string[]; savedLists: SavedList[]; onClose: () => void;
  onAddToList: (listId: string) => void; onCreateList: () => void;
  newListName: string; setNewListName: (v: string) => void; addingToList: boolean;
}) {
  const count = selectedCreators.length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={!addingToList ? onClose : undefined}>
      <div className="rounded-2xl p-6 w-80 shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">Add to list</h3>
          {!addingToList && (
            <button onClick={onClose} style={{ color: "var(--text-secondary)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
          Adding <span style={{ color: "var(--accent)", fontWeight: 600 }}>{count} creator{count !== 1 ? "s" : ""}</span> to a list
        </p>
        {addingToList ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Adding creators…</p>
          </div>
        ) : (
          <>
            {savedLists.length > 0 && (
              <div className="flex items-center justify-between px-3 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>List Name</span>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Creators</span>
              </div>
            )}
            {savedLists.length === 0 ? (
              <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>No lists yet. Create one below.</p>
            ) : (
              <div className="space-y-1.5 mb-4 max-h-52 overflow-y-auto">
                {savedLists.map(list => (
                  <button key={list.id} onClick={() => onAddToList(list.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-all"
                    style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid transparent" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.1)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--accent)" }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    <span className="flex-1 truncate font-medium">{list.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface)", color: "var(--text-secondary)" }}>{list._count.items}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Create new list</p>
              <div className="flex gap-2">
                <input value={newListName} onChange={e => setNewListName(e.target.value)} onKeyDown={e => e.key === "Enter" && onCreateList()}
                  placeholder="List name…" className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                <button onClick={onCreateList} disabled={!newListName.trim()} className="px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "white" }}>Create</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const FILTER_LABELS: Record<string, string> = {
  niche: "Niche", gender: "Gender", ageGroup: "Age", country: "Country", state: "State", city: "City",
  creatorSize: "Size", creatorType: "Type", collabStatus: "Status",
  followersMin: "Min Followers", followersMax: "Max Followers",
  hasEmail: "Has Email", hasTiktok: "Has TikTok", hasYoutube: "Has YouTube",
};

function ActiveFilterPills({ filters, onRemove }: { filters: typeof DEFAULT_FILTERS; onRemove: (key: string) => void }) {
  const active = Object.entries(filters).filter(([k, v]) => !["sortBy", "sortOrder"].includes(k) && v !== "");
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-6 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
      {active.map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)", border: "1px solid rgba(99,102,241,0.3)" }}>
          {FILTER_LABELS[k] ?? k}: {k === "followersMin" || k === "followersMax" ? fmtNum(v) : v}
          <button onClick={() => onRemove(k)} className="ml-0.5 opacity-70 hover:opacity-100" aria-label={`Remove ${k} filter`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </span>
      ))}
    </div>
  );
}
function StyledSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: JSX.Element | JSX.Element[] }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full appearance-none px-3 py-2 pr-8 rounded-lg text-sm outline-none transition-colors"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
        {children}
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
        style={{ color: "var(--text-secondary)" }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, placeholder = "Any" }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>{label}</label>
      <StyledSelect value={value} onChange={onChange}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </StyledSelect>
    </div>
  );
}

function TriToggle({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const options = [{ v: "", label: "Any" }, { v: "true", label: "Yes" }, { v: "false", label: "No" }];
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>{label}</label>
      <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {options.map((o, i) => (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: value === o.v ? "var(--accent)" : "var(--surface)",
              color: value === o.v ? "white" : "var(--text-secondary)",
              borderRight: i < options.length - 1 ? "1px solid var(--border)" : "none",
            }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterSectionLabel({ icon, children }: { icon: JSX.Element; children: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--text-secondary)" }}>
      {icon}{children}
    </p>
  );
}
const DASHBOARD_STATE_KEY = "dashboard_state";

function saveDashboardState(state: { rawQuery: string; filters: typeof DEFAULT_FILTERS; page: number }) {
  try { sessionStorage.setItem(DASHBOARD_STATE_KEY, JSON.stringify(state)); } catch {}
}

function loadDashboardState(): { rawQuery: string; filters: typeof DEFAULT_FILTERS; page: number } | null {
  try {
    const s = sessionStorage.getItem(DASHBOARD_STATE_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  // All state initializes to SSR-safe defaults (matching what the server renders).
  // Real values are restored from sessionStorage + cache in useLayoutEffect below.
  const [creators, setCreators] = useState<Creator[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<typeof DEFAULT_FILTERS>({ ...DEFAULT_FILTERS });

  const [showFilters, setShowFilters] = useState(false);
  const [showListsSidebar, setShowListsSidebar] = useState(false);
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set());
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [addingToList, setAddingToList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);
  const [nicheOptions, setNicheOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [stateOptions, setStateOptions] = useState<string[]>([]);
  const [creatorTypeOptions, setCreatorTypeOptions] = useState<string[]>([]);

  const cleanQueryRef = useRef("");
  const lexiconsRef = useRef<Lexicons>(EMPTY_LEXICONS);
  const requestId = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Starts true so the [page] effect is suppressed on initial mount.
  // The [rawQuery, filters] effect owns the first fetch via its debounce.
  const skipNextPageEffectRef = useRef(true);

  /**
   * Restore session state + seed creators from cache BEFORE first paint.
   * Runs only on the client (never on server), so SSR HTML always matches
   * the plain defaults above — no hydration mismatch.
   */
  useLayoutEffect(() => {
    try {
      const s = loadDashboardState();
      if (!s) return;

      // Restore UI state from session
      if (s.rawQuery) setRawQuery(s.rawQuery);
      if (s.page && s.page !== 1) setPage(s.page);
      if (s.filters) setFilters(s.filters);

      // Immediately show cached creators — zero network call, zero spinner
      const { key } = buildCacheKey(s.rawQuery ?? "", s.page ?? 1, s.filters ?? { ...DEFAULT_FILTERS });
      const cached = getCached<CreatorResult>(key);
      if (cached) {
        setCreators(cached.creators);
        setPagination(cached.pagination);
        // loading stays false — we have data to show right away
      }
    } catch (error) {
      console.error("Error restoring dashboard state:", error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lexiconsRef.current = { niches: nicheOptions, countries: countryOptions, cities: cityOptions, states: stateOptions, creatorTypes: creatorTypeOptions };
  }, [nicheOptions, countryOptions, cityOptions, stateOptions, creatorTypeOptions]);

  function showToast(msg: string, type: Toast["type"] = "success") {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }

  function confirm(dialog: ConfirmDialog) { setConfirmDialog(dialog); }

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      cachedFetch("auth/me", () =>
        fetch("/api/auth/me").then(r => { if (!r.ok) { router.push("/login"); return null; } return r.json(); })
      ).then(d => { if (d) setUser(d.user); }).catch(() => router.push("/login"));

      // Always fetch lists fresh on mount — bypasses the cache entirely so
      // navigating back from the lists page (where a list may have been deleted
      // or renamed) always shows up-to-date data without a stale-cache hit.
      invalidateCache("lists");
      fetch("/api/lists")
        .then(r => r.ok ? r.json() : { lists: [] })
        .then(d => {
          const lists = d.lists || [];
          // Write back into the store so any other cachedFetch("lists") call
          // within this session sees the fresh data without a second round-trip.
          setCached("lists", { lists });
          setSavedLists(lists);
        })
        .catch(err => {
          console.error("Error fetching lists on mount:", err);
          toast.error("Failed to load lists");
        });

      cachedFetch("creators/meta", () =>
        fetch("/api/creators/meta").then(r => r.ok ? r.json() : {})
      ).then((d: CreatorsMetaResponse) => {
        setNicheOptions((d.primaryniches || []).filter(Boolean).sort());
        setCountryOptions((d.countries || []).filter(Boolean).sort());
        setCityOptions((d.cities || []).filter(Boolean).sort());
        setStateOptions((d.states || []).filter(Boolean).sort());
        setCreatorTypeOptions((d.creatorTypes || []).filter(Boolean).sort());
      }).catch(err => {
        console.error("Error fetching creators meta:", err);
      });
    } catch (error) {
      console.error("Error fetching initial data:", error);
      toast.error("Failed to load initial data");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      saveDashboardState({ rawQuery, filters, page });
    } catch (error) {
      console.error("Error saving dashboard state:", error);
    }
  }, [rawQuery, filters, page]);

  /**
   * fetchCreators — the single source of truth for loading creator data.
   *
   * Cache behaviour:
   *   FRESH HIT  → show instantly, zero network call
   *   STALE HIT  → show instantly, revalidate silently in background
   *   MISS       → show spinner, fetch, store in client-cache store
   *
   * The key is `creators:<URLSearchParams>` — identical to the URL query string,
   * so every unique filter/page combination has its own cache entry.
   */
  const fetchCreators = useCallback(async (
    q: string,
    p: number,
    f: typeof DEFAULT_FILTERS,
    opts?: { reqId?: number }
  ) => {
    try {
      const { key, params } = buildCacheKey(q, p, f);
      const myReqId = opts?.reqId ?? requestId.current;

      // Single fetcher definition reused for both foreground and background paths
      const fetcher = (): Promise<CreatorResult> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort("timeout"), 30_000);
        return fetch(`/api/creators?${params}`, { signal: controller.signal })
          .then(async (res) => {
            clearTimeout(timeoutId);
            if (res.status === 401) { router.push("/login"); throw new Error("401"); }
            if (!res.ok) throw new Error("fetch failed");
            const json = await res.json();
            return { creators: json.creators || [], pagination: json.pagination || null };
          })
          .catch((err) => { clearTimeout(timeoutId); throw err; });
      };

      // Check the store directly so we can inspect both the data AND the age
      // without triggering a redundant cachedFetch call.
      const entry = getCacheEntry<CreatorResult>(key);
      if (entry) {
        // Always show cached data immediately — no spinner regardless of staleness
        setCreators(entry.data.creators);
        setPagination(entry.data.pagination);
        setLoading(false);

        // Only hit the network if data is actually stale
        const isStale = Date.now() - entry.fetchedAt >= SEARCH_CACHE_TTL_MS;
        if (isStale) {
          cachedFetch<CreatorResult>(key, fetcher, SEARCH_CACHE_TTL_MS)
            .then((fresh) => {
              if (myReqId !== requestId.current) return;
              setCreators(fresh.creators);
              setPagination(fresh.pagination);
            })
            .catch(() => { /* silent — user already sees valid cached data */ });
        }
        return;
      }

      // Cache miss — genuine first load, show spinner
      setLoading(true);
      try {
        const data = await cachedFetch<CreatorResult>(key, fetcher, SEARCH_CACHE_TTL_MS);
        if (myReqId !== requestId.current) return;
        setCreators(data.creators);
        setPagination(data.pagination);
      } catch (err: unknown) {
        if (myReqId !== requestId.current) return;
        if (err instanceof Error && err.message === "401") return;
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const errorMsg = isTimeout ? "Request timed out — please try again" : "Failed to load creators";
        showToast(errorMsg, "error");
        toast.error(errorMsg);
      } finally {
        if (myReqId === requestId.current) setLoading(false);
      }
    } catch (error) {
      console.error("Error in fetchCreators:", error);
      toast.error("An unexpected error occurred");
    }
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fires on rawQuery or filters change — debounced 300ms
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      try {
        const { cleanQuery: cq, extractedFilters } = parseNaturalQuery(rawQuery, lexiconsRef.current);
        cleanQueryRef.current = cq;
        const mergedFilters = { ...filters, ...extractedFilters };
        const myReqId = ++requestId.current;
        skipNextPageEffectRef.current = true;
        setPage(1);
        fetchCreators(cq, 1, mergedFilters, { reqId: myReqId });
      } catch (error) {
        console.error("Error parsing query:", error);
        toast.error("Error parsing search query");
      }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawQuery, filters]);

  // Fires on manual page change only (skipNextPageEffectRef guards against mount double-fetch)
  useEffect(() => {
    if (skipNextPageEffectRef.current) {
      skipNextPageEffectRef.current = false;
      return;
    }
    try {
      const myReqId = ++requestId.current;
      fetchCreators(cleanQueryRef.current, page, filters, { reqId: myReqId });
    } catch (error) {
      console.error("Error fetching creators on page change:", error);
      toast.error("Error loading page");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Signed out successfully");
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Failed to sign out");
    }
  }

  function refreshLists() {
    // Invalidate then fetch directly — always hits network after a mutation.
    // We use setCached to update the module-level store so future cachedFetch
    // calls see the fresh data without a redundant network round-trip.
    invalidateCache("lists");
    fetch("/api/lists")
      .then(r => r.ok ? r.json() : { lists: [] })
      .then(d => {
        const lists = d.lists || [];
        setCached("lists", { lists });
        setSavedLists(lists);
      })
      .catch(err => {
        console.error("Error refreshing lists:", err);
        toast.error("Failed to refresh lists");
      });
  }

  async function createList() {
    try {
      if (!newListName.trim()) return;
      const trimmed = newListName.trim();
      const duplicate = savedLists.some(l => l.name.toLowerCase() === trimmed.toLowerCase());
      if (duplicate) {
        toast.error(`A list named "${trimmed}" already exists`);
        return;
      }
      const res = await fetch("/api/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }) });
      if (res.ok) {
        setNewListName("");
        refreshLists();
        toast.success("List created successfully");
      } else {
        toast.error("Failed to create list");
      }
    } catch (error) {
      console.error("Error creating list:", error);
      toast.error("An error occurred while creating the list");
    }
  }

  async function addSelectedToList(listId: string) {
    try {
      const ids = Array.from(selectedCreators);
      setAddingToList(true);
      let added = 0, skipped = 0, failed = 0;
      await Promise.all(ids.map(async creatorId => {
        try {
          const res = await fetch(`/api/lists/${listId}/items`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId }),
          });
          if (res.ok) added++;
          else if (res.status === 409) skipped++;
          else failed++;
        } catch {
          failed++;
        }
      }));
      refreshLists();
      setAddingToList(false);
      setShowAddToListModal(false);
      setSelectedCreators(new Set());
      const parts = [];
      if (added > 0) parts.push(`${added} added`);
      if (skipped > 0) parts.push(`${skipped} already in list`);
      if (failed > 0) parts.push(`${failed} failed`);
      const message = parts.join(", ");
      if (failed > 0) {
        toast.error(message);
      } else if (added > 0) {
        toast.success(message);
      } else {
        toast.success("No changes made");
      }
    } catch (error) {
      console.error("Error adding to list:", error);
      toast.error("Failed to add creators to list");
      setAddingToList(false);
    }
  }

  async function createListAndAddSelected() {
    try {
      if (!newListName.trim()) return;
      const trimmed = newListName.trim();
      const duplicate = savedLists.some(l => l.name.toLowerCase() === trimmed.toLowerCase());
      if (duplicate) {
        toast.error(`A list named "${trimmed}" already exists`);
        return;
      }
      setAddingToList(true);
      const res = await fetch("/api/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }) });
      if (!res.ok) {
        setAddingToList(false);
        toast.error("Failed to create list");
        return;
      }
      const data = await res.json();
      setNewListName("");
      refreshLists();
      await addSelectedToList(data.list.id);
    } catch (error) {
      console.error("Error creating list and adding selected:", error);
      toast.error("An error occurred");
      setAddingToList(false);
    }
  }

  function handleDeleteList(id: string, name: string) {
    confirm({
      title: "Delete list",
      body: `"${name}" and all its creators will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete list", danger: true,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
          if (res.ok) {
            refreshLists();
            toast.success("List deleted successfully");
          } else {
            toast.error("Failed to delete list");
          }
        } catch (error) {
          console.error("Error deleting list:", error);
          toast.error("An error occurred while deleting the list");
        }
      },
    });
  }

  function clearAllFilters() {
    try {
      setFilters({ ...DEFAULT_FILTERS });
      setRawQuery("");
      cleanQueryRef.current = "";
      toast.success("All filters cleared");
    } catch (error) {
      console.error("Error clearing filters:", error);
    }
  }

  function removeFilter(key: string) {
    try {
      setFilters(prev => ({ ...prev, [key]: "" }));
    } catch (error) {
      console.error("Error removing filter:", error);
    }
  }

  function toggleCreator(id: string) {
    try {
      setSelectedCreators(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    } catch (error) {
      console.error("Error toggling creator:", error);
    }
  }

  function toggleSelectAll() {
    try {
      const allIds = creators.map(c => c.username || c.pk);
      if (allIds.every(id => selectedCreators.has(id))) {
        setSelectedCreators(new Set());
      } else {
        setSelectedCreators(new Set(allIds));
      }
    } catch (error) {
      console.error("Error toggling select all:", error);
    }
  }

  function viewCreator(username: string) {
    try {
      router.push(`/dashboard/creators/${username}`);
    } catch (error) {
      console.error("Error navigating to creator:", error);
      toast.error("Failed to navigate to creator");
    }
  }

  function openList(listId: string) {
    try {
      sessionStorage.setItem("lists_sidebar_open", "true");
      router.push(`/dashboard/lists?id=${listId}`);
    } catch (error) {
      console.error("Error opening list:", error);
      toast.error("Failed to open list");
    }
  }

  useEffect(() => {
    try {
      const open = sessionStorage.getItem("lists_sidebar_open");
      if (open === "true") { setShowListsSidebar(true); sessionStorage.removeItem("lists_sidebar_open"); }
    } catch {}
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeFiltersCount = Object.entries(filters).filter(([k, v]) => !["sortBy", "sortOrder"].includes(k) && v !== "").length;
  const inputStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const selectStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const allSelected = creators.length > 0 && creators.every(c => selectedCreators.has(c.username || c.pk));
  const someSelected = selectedCreators.size > 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes filterIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-filterIn { animation: filterIn 0.15s ease; }
        .animate-spin { animation: spin 0.7s linear infinite; }
        select option { background: #1f2937; color: #f9fafb; }
        * { -webkit-user-select: none; user-select: none; }
        input, textarea { -webkit-user-select: text; user-select: text; }
      `}</style>

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

      <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)" }}>

        {/* ── Sidebar ── */}
        <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          {/* Logo */}
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
            {/* Search link */}
            <a href="/dashboard"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <span>Search</span>
            </a>

            {/* Saved Lists */}
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
                  {savedLists.length === 0 ? (
                    <p className="text-xs px-2 py-2" style={{ color: "var(--text-secondary)" }}>No lists yet</p>
                  ) : (
                    savedLists.map(list => (
                      <button key={list.id} onClick={() => openList(list.id)}
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
                  )}
                  {/* New list input */}
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

            {/* Admin */}
            {user?.role === "ADMIN" && (
              <a href="/admin"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Admin</span>
              </a>
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
            <button onClick={() => setShowSignOut(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Search bar */}
          <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-secondary)" }}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input value={rawQuery} onChange={e => setRawQuery(e.target.value)}
                  placeholder='Try "Germany food creators 20k+ female age 20-30 with email"'
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
                {rawQuery && (
                  <button onClick={clearAllFilters} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-secondary)" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
              <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: showFilters ? "rgba(99,102,241,0.15)" : "var(--surface-2)", border: `1px solid ${showFilters ? "var(--accent)" : "var(--border)"}`, color: showFilters ? "var(--accent)" : "var(--text-secondary)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Filters
                {activeFiltersCount > 0 && <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--accent)", color: "white" }}>{activeFiltersCount}</span>}
              </button>
            </div>

            {showFilters && (
              <div className="mt-4 rounded-2xl overflow-hidden animate-filterIn" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" style={{ color: "var(--accent)" }}>
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Filters</span>
                    {activeFiltersCount > 0 && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
                        {activeFiltersCount} active
                      </span>
                    )}
                  </div>
                  <button onClick={clearAllFilters} className="flex items-center gap-1.5 text-xs font-medium transition-colors" style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" /></svg>
                    Clear all
                  </button>
                </div>

                <div className="p-5 space-y-6">
                  <div>
                    <FilterSectionLabel icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z" /><circle cx="12" cy="10" r="3" /></svg>}>
                      Location
                    </FilterSectionLabel>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <FilterSelect label="Country" value={filters.country} onChange={v => setFilters(p => ({ ...p, country: v }))} options={countryOptions} placeholder="All countries" />
                      <FilterSelect label="State" value={filters.state} onChange={v => setFilters(p => ({ ...p, state: v }))} options={stateOptions} placeholder="All states" />
                      <FilterSelect label="City" value={filters.city} onChange={v => setFilters(p => ({ ...p, city: v }))} options={cityOptions} placeholder="All cities" />
                    </div>
                  </div>

                  <div>
                    <FilterSectionLabel icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}>
                      Audience
                    </FilterSectionLabel>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>Gender</label>
                        <StyledSelect value={filters.gender} onChange={v => setFilters(p => ({ ...p, gender: v }))}>
                          <option value="">Any</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
                        </StyledSelect>
                      </div>
                      <div>
                        <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>Age Group</label>
                        <StyledSelect value={filters.ageGroup} onChange={v => setFilters(p => ({ ...p, ageGroup: v }))}>
                          <option value="">Any</option><option value="18-24">18–24</option><option value="25-34">25–34</option><option value="35-44">35–44</option><option value="45+">45+</option>
                        </StyledSelect>
                      </div>
                      <FilterSelect label="Creator Size" value={filters.creatorSize} onChange={v => setFilters(p => ({ ...p, creatorSize: v }))} options={CREATOR_SIZES} />
                    </div>
                  </div>

                  <div>
                    <FilterSectionLabel icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M20.59 13.41L11 3.83A2 2 0 0 0 9.59 3H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z" /><circle cx="7" cy="7" r="1" /></svg>}>
                      Content
                    </FilterSectionLabel>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <FilterSelect label="Niche" value={filters.niche} onChange={v => setFilters(p => ({ ...p, niche: v }))} options={nicheOptions} placeholder="All niches" />
                      <FilterSelect label="Creator Type" value={filters.creatorType} onChange={v => setFilters(p => ({ ...p, creatorType: v }))} options={creatorTypeOptions} placeholder="Any type" />
                      <div>
                        <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>Collab Status</label>
                        <StyledSelect value={filters.collabStatus} onChange={v => setFilters(p => ({ ...p, collabStatus: v }))}>
                          <option value="">Any</option><option value="active">Active</option><option value="closed">Closed</option>
                        </StyledSelect>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
                    <div>
                      <FilterSectionLabel icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>}>
                        Follower Range
                      </FilterSectionLabel>
                      <div className="flex items-center gap-2">
                        <input type="number" value={filters.followersMin} onChange={e => setFilters(p => ({ ...p, followersMin: e.target.value }))}
                          placeholder="10000" className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                        <span className="text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>to</span>
                        <input type="number" value={filters.followersMax} onChange={e => setFilters(p => ({ ...p, followersMax: e.target.value }))}
                          placeholder="500000" className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                      </div>
                    </div>
                    <div>
                      <FilterSectionLabel icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg>}>
                        Contact &amp; Channels
                      </FilterSectionLabel>
                      <div className="flex flex-wrap gap-4">
                        <TriToggle label="Email" value={filters.hasEmail} onChange={v => setFilters(p => ({ ...p, hasEmail: v }))} />
                        <TriToggle label="TikTok" value={filters.hasTiktok} onChange={v => setFilters(p => ({ ...p, hasTiktok: v }))} />
                        <TriToggle label="YouTube" value={filters.hasYoutube} onChange={v => setFilters(p => ({ ...p, hasYoutube: v }))} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-end gap-2 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
                    <div className="w-40">
                      <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>Sort by</label>
                      <StyledSelect value={filters.sortBy} onChange={v => setFilters(p => ({ ...p, sortBy: v }))}>
                        <option value="followerCount">Followers</option>
                        <option value="lastUpdated">Last Updated</option>
                      </StyledSelect>
                    </div>
                    <button onClick={() => setFilters(p => ({ ...p, sortOrder: p.sortOrder === "desc" ? "asc" : "desc" }))} type="button"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                      title={filters.sortOrder === "desc" ? "Descending" : "Ascending"}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"
                        style={{ transform: filters.sortOrder === "asc" ? "scaleY(-1)" : "none" }}>
                        <path d="M7 13l5 5 5-5M12 18V6" />
                      </svg>
                      {filters.sortOrder === "desc" ? "Desc" : "Asc"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <ActiveFilterPills filters={filters} onRemove={removeFilter} />

          {/* Results count + toolbar */}
          <div className="px-6 py-2.5 flex items-center gap-3 text-sm" style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                Searching…
              </span>
            ) : (
              pagination && `${pagination.total.toLocaleString()} creators found`
            )}
            {creators.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                {someSelected && (
                  <button onClick={() => setShowAddToListModal(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--accent)", color: "white" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    Add {selectedCreators.size} to list
                  </button>
                )}
                {someSelected && (
                  <button onClick={() => setSelectedCreators(new Set())} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Clear selection</button>
                )}
                <button onClick={toggleSelectAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: allSelected ? "rgba(99,102,241,0.15)" : "var(--surface-2)", color: allSelected ? "var(--accent)" : "var(--text-secondary)", border: `1px solid ${allSelected ? "var(--accent)" : "var(--border)"}` }}>
                  <div className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0" style={{ borderColor: allSelected ? "var(--accent)" : "var(--text-secondary)", background: allSelected ? "var(--accent)" : "transparent" }}>
                    {allSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>
            )}
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
                  <button onClick={clearAllFilters} className="mt-4 px-4 py-2 rounded-lg text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent)" }}>Clear all filters</button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {creators.map(c => {
                  const creatorId = c.username || c.pk;
                  const isSelected = selectedCreators.has(creatorId);
                  return (
                    <div key={creatorId} className="rounded-xl p-4 flex flex-col group relative"
                      style={{ background: "var(--surface)", border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)", boxShadow: isSelected ? "0 0 0 3px rgba(99,102,241,0.12)" : "none" }}>

                      {/* Checkbox */}
                      <button onClick={() => toggleCreator(creatorId)}
                        className="absolute top-3 right-3 w-5 h-5 rounded border-2 flex items-center justify-center transition-all"
                        style={{ borderColor: isSelected ? "var(--accent)" : "var(--border)", background: isSelected ? "var(--accent)" : "transparent" }}>
                        {isSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>

                      {/* Avatar + name */}
                      <div className="flex items-start gap-3 pr-7 mb-3">
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

                      {/* Tags row */}
                      <div className="flex flex-wrap gap-1.5 mb-3" style={{ minHeight: "1.5rem" }}>
                        {c.nichePrimary && <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>{c.nichePrimary}</span>}
                        {c.creatorSize && <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(0,0,0,0.2)", color: sizeColor[c.creatorSize] || "var(--text-secondary)" }}>{c.creatorSize}</span>}
                        {c.addressCountry && <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>{c.addressCity ? `${c.addressCity}, ` : ""}{c.addressCountry}</span>}
                      </div>

                      {/* Followers + gender */}
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <span className="font-semibold">{fmtNum(c.followerCount)}</span>
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>followers</span>
                        {c.gender && <span className="text-xs ml-auto capitalize" style={{ color: "var(--text-secondary)" }}>{c.gender}</span>}
                      </div>

                      {/* Collabs */}
                      <div className="mb-2" style={{ minHeight: "1.25rem" }}>
                        {c.totalCollaborationsInRecent25 !== null && c.totalCollaborationsInRecent25 !== undefined && (
                          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>🤝 {c.totalCollaborationsInRecent25} collabs in last 25 posts</div>
                        )}
                      </div>

                      {/* Social + status badges */}
                      <div className="flex gap-1.5 mb-3">
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

                      {/* Footer */}
                      <div className="mt-auto flex gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                        <button onClick={() => c.username && viewCreator(c.username)} className="flex-1 py-1.5 rounded-lg text-xs font-medium text-center transition-colors" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>View details</button>
                        <button onClick={() => { setSelectedCreators(new Set([creatorId])); setShowAddToListModal(true); }} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>+ List</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8 pb-4">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || loading} className="px-4 py-2 rounded-lg text-sm disabled:opacity-40" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>← Previous</button>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Page {page} of {pagination.totalPages}</span>
                <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages || loading} className="px-4 py-2 rounded-lg text-sm disabled:opacity-40" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>Next →</button>
              </div>
            )}
          </div>
        </main>

        {showAddToListModal && (
          <AddToListModal
            selectedCreators={Array.from(selectedCreators)} savedLists={savedLists}
            onClose={() => { if (!addingToList) setShowAddToListModal(false); }}
            onAddToList={addSelectedToList} onCreateList={createListAndAddSelected}
            newListName={newListName} setNewListName={setNewListName} addingToList={addingToList}
          />
        )}
      </div>

      {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
      {showSignOut && <SignOutModal onConfirm={logout} onClose={() => setShowSignOut(false)} userName={user?.email ?? ""} />}
      <ToastStack toasts={toasts} />
    </>
  );
}