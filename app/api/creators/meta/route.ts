// app/api/creators/meta/route.ts
// Returns all distinct niche, country, city, state, creatorType, age_group values.
// Used to populate filter dropdowns in the dashboard.
//
// Accepts optional ?country= and ?state= to cascade dropdowns:
//   - No params       → all countries, states, cities, niches, types, age groups
//   - ?country=X      → states within X only
//   - ?country=X&state=Y → cities within X,Y only
//
// Cache is keyed by `${country}:${state}` so each cascade combo is stored
// independently (same TTL as before — 10 minutes).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type MetaData = {
  primaryniches: string[];
  countries: string[];
  age_group: string[];
  cities: string[];
  creatorTypes: string[];
  states: string[];
};

// Keyed by `${country}:${state}` — empty strings for the base (no-filter) case
const cache = new Map<string, { data: MetaData; expires: number }>();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country") ?? "";
  const state   = searchParams.get("state")   ?? "";

  const cacheKey = `${country}:${state}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (country) { conditions.push(`address_country ILIKE $${i}`); values.push(country); i++; }
    if (state)   { conditions.push(`address_state   ILIKE $${i}`); values.push(state);   i++; }

    const whereClause = conditions.length
      ? `AND (${conditions.join(" AND ")})`
      : "";

    // Single query — one table scan instead of 5 separate findMany calls
    const rows = await prisma.$queryRawUnsafe<{
      niche_primary:   string | null;
      address_country: string | null;
      address_city:    string | null;
      age_group:       string | null;
      creator_type:    string | null;
      address_state:   string | null;
    }[]>(
      `SELECT DISTINCT
         niche_primary,
         address_country,
         address_city,
         age_group,
         creator_type,
         address_state
       FROM bronze.creators
       WHERE (
         niche_primary   IS NOT NULL OR
         address_country IS NOT NULL OR
         address_city    IS NOT NULL OR
         age_group       IS NOT NULL OR
         creator_type    IS NOT NULL OR
         address_state   IS NOT NULL
       )
       ${whereClause}`,
      ...values,
    );

    const primaryniches = [...new Set(rows.map(r => r.niche_primary).filter(Boolean)   as string[])].sort();
    const countries     = [...new Set(rows.map(r => r.address_country).filter(Boolean) as string[])].sort();
    const cities        = [...new Set(rows.map(r => r.address_city).filter(Boolean)    as string[])].sort();
    // age_group is a plain scalar text column (see schema.prisma), not an
    // array — use map(), not flatMap(), to collect distinct values.
    const age_group     = [...new Set(rows.map(r => r.age_group).filter(Boolean)       as string[])].sort();
    const creatorTypes  = [...new Set(rows.map(r => r.creator_type).filter(Boolean)    as string[])].sort();
    const states        = [...new Set(rows.map(r => r.address_state).filter(Boolean)   as string[])].sort();

    const data: MetaData = { primaryniches, countries, age_group, cities, creatorTypes, states };
    cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Meta fetch error:", err);
    return NextResponse.json(
      { primaryniches: [], countries: [], age_group: [], cities: [], creatorTypes: [], states: [] },
      { status: 500 },
    );
  }
}