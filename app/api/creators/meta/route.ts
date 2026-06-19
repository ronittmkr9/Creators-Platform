// app/api/creators/meta/route.ts
// Returns all distinct niche, country, city, state, creatorType, age_group values.
// Used to populate filter dropdowns in the dashboard.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let cache: {
  data: { primaryniches: string[]; countries: string[]; age_group: string[]; cities: string[]; creatorTypes: string[]; states: string[] };
  expires: number;
} | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.data);
  }

  try {
    // Single query — one table scan instead of 5 separate findMany calls
    const rows = await prisma.$queryRaw<
      { niche_primary: string | null; address_country: string | null; address_city: string | null; age_group: string | null; creator_type: string | null; address_state: string | null }[]
    >`
      SELECT DISTINCT
        niche_primary,
        address_country,
        address_city,
        age_group,
        creator_type,
        address_state
      FROM bronze.creators
      WHERE
        niche_primary IS NOT NULL OR
        address_country IS NOT NULL OR
        address_city IS NOT NULL OR
        age_group IS NOT NULL OR
        creator_type IS NOT NULL OR
        address_state IS NOT NULL
    `;

    const primaryniches = [...new Set(rows.map(r => r.niche_primary).filter(Boolean) as string[])].sort();
    const countries     = [...new Set(rows.map(r => r.address_country).filter(Boolean) as string[])].sort();
    const cities        = [...new Set(rows.map(r => r.address_city).filter(Boolean) as string[])].sort();
    // age_group is a plain scalar text column (see schema.prisma), not an
    // array — use map(), not flatMap(), to collect distinct values.
    const age_group     = [...new Set(rows.map(r => r.age_group).filter(Boolean) as string[])].sort();
    const creatorTypes  = [...new Set(rows.map(r => r.creator_type).filter(Boolean) as string[])].sort();
    const states        = [...new Set(rows.map(r => r.address_state).filter(Boolean) as string[])].sort();

    const data = { primaryniches, countries, age_group, cities, creatorTypes, states };
    cache = { data, expires: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(data);
  } catch (err) {
    console.error("Meta fetch error:", err);
    return NextResponse.json(
      { primaryniches: [], countries: [], age_group: [], cities: [], creatorTypes: [], states: [] },
      { status: 500 },
    );
  }
}