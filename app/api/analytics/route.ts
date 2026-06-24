import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { Prisma } from "@prisma/client";

type Row = { name: string; count: number };
type SummaryRow = { total: number; countries: number; niches: number };

const DEDUP_ORDER = Prisma.sql`ORDER BY LOWER(username), COALESCE(analyzed_date, last_updated) DESC NULLS LAST`;

function buildFilter(country: string | null, state: string | null, city: string | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (country) parts.push(Prisma.sql`address_country = ${country}`);
  if (state) parts.push(Prisma.sql`address_state = ${state}`);
  if (city) parts.push(Prisma.sql`address_city = ${city}`);
  return parts.length > 0 ? Prisma.join(parts, " AND ") : Prisma.sql`1=1`;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const analyticsCache = new Map<string, { data: unknown; expires: number }>();

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country") || null;
  const state = searchParams.get("state") || null;
  const city = searchParams.get("city") || null;

  const cacheKey = `${country}|${state}|${city}`;
  const cached = analyticsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const f = buildFilter(country, state, city);

  try {
    const [summary, byCountry, byNiche, byAgeGroup, byGender, byCreatorType, states, cities] =
      await Promise.all([
        prisma.$queryRaw<SummaryRow[]>`
          SELECT
            COUNT(*)::int AS total,
            COUNT(DISTINCT address_country)::int AS countries,
            COUNT(DISTINCT niche_primary)::int AS niches
          FROM (
            SELECT DISTINCT ON (LOWER(username)) address_country, niche_primary
            FROM bronze.creators
            WHERE username IS NOT NULL AND ${f}
            ${DEDUP_ORDER}
          ) deduped
        `,
        !country
          ? prisma.$queryRaw<Row[]>`
              SELECT name, COUNT(*)::int AS count
              FROM (
                SELECT DISTINCT ON (LOWER(username)) address_country AS name
                FROM bronze.creators
                WHERE username IS NOT NULL AND address_country IS NOT NULL
                ${DEDUP_ORDER}
              ) deduped
              WHERE name IS NOT NULL
              GROUP BY name ORDER BY count DESC LIMIT 30
            `
          : Promise.resolve([] as Row[]),
        prisma.$queryRaw<Row[]>`
          SELECT name, COUNT(*)::int AS count
          FROM (
            SELECT DISTINCT ON (LOWER(username)) niche_primary AS name
            FROM bronze.creators
            WHERE username IS NOT NULL AND ${f} AND niche_primary IS NOT NULL
            ${DEDUP_ORDER}
          ) deduped
          WHERE name IS NOT NULL
          GROUP BY name ORDER BY count DESC LIMIT 20
        `,
        prisma.$queryRaw<Row[]>`
          SELECT name, COUNT(*)::int AS count
          FROM (
            SELECT DISTINCT ON (LOWER(username)) age_group AS name
            FROM bronze.creators
            WHERE username IS NOT NULL AND ${f} AND age_group IS NOT NULL AND age_group != 'Unknown'
            ${DEDUP_ORDER}
          ) deduped
          WHERE name IS NOT NULL
          GROUP BY name ORDER BY count DESC
        `,
        prisma.$queryRaw<Row[]>`
          SELECT name, COUNT(*)::int AS count
          FROM (
            SELECT DISTINCT ON (LOWER(username)) gender AS name
            FROM bronze.creators
            WHERE username IS NOT NULL AND ${f} AND gender IS NOT NULL AND gender != 'Unknown'
            ${DEDUP_ORDER}
          ) deduped
          WHERE name IS NOT NULL
          GROUP BY name ORDER BY count DESC
        `,
        prisma.$queryRaw<Row[]>`
          SELECT name, COUNT(*)::int AS count
          FROM (
            SELECT DISTINCT ON (LOWER(username)) creator_type AS name
            FROM bronze.creators
            WHERE username IS NOT NULL AND ${f} AND creator_type IS NOT NULL
            ${DEDUP_ORDER}
          ) deduped
          WHERE name IS NOT NULL
          GROUP BY name ORDER BY count DESC LIMIT 15
        `,
        country && !state
          ? prisma.$queryRaw<Row[]>`
              SELECT name, COUNT(*)::int AS count
              FROM (
                SELECT DISTINCT ON (LOWER(username)) address_state AS name
                FROM bronze.creators
                WHERE username IS NOT NULL AND address_country = ${country} AND address_state IS NOT NULL
                ${DEDUP_ORDER}
              ) deduped
              WHERE name IS NOT NULL
              GROUP BY name ORDER BY count DESC
            `
          : Promise.resolve([] as Row[]),
        state
          ? prisma.$queryRaw<Row[]>`
              SELECT name, COUNT(*)::int AS count
              FROM (
                SELECT DISTINCT ON (LOWER(username)) address_city AS name
                FROM bronze.creators
                WHERE username IS NOT NULL AND address_country = ${country} AND address_state = ${state} AND address_city IS NOT NULL
                ${DEDUP_ORDER}
              ) deduped
              WHERE name IS NOT NULL
              GROUP BY name ORDER BY count DESC LIMIT 50
            `
          : Promise.resolve([] as Row[]),
      ]);

    const result = {
      summary: summary[0] ?? { total: 0, countries: 0, niches: 0 },
      byCountry,
      byNiche,
      byAgeGroup,
      byGender,
      byCreatorType,
      states,
      cities,
    };

    analyticsCache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL_MS });
    if (analyticsCache.size > 100) {
      const oldest = analyticsCache.keys().next().value;
      if (oldest) analyticsCache.delete(oldest);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Analytics error:", err);
    return NextResponse.json(
      { summary: { total: 0, countries: 0, niches: 0 }, byCountry: [], byNiche: [], byAgeGroup: [], byGender: [], byCreatorType: [], states: [], cities: [] },
      { status: 500 },
    );
  }
}
