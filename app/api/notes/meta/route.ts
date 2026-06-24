// app/api/notes/meta/route.ts
// Returns distinct filter options among creators THIS USER has notes on.
// Accepts optional ?country= and ?state= to cascade dropdowns:
//   - No params       → countries, ageGroups, genders (full lists)
//   - ?country=X      → states within X  (+ ageGroups/genders scoped to X)
//   - ?country=X&state=Y → cities within X,Y

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type NotesMeta = {
  countries: string[];
  states: string[];
  cities: string[];
  ageGroups: string[];
  genders: string[];
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country") ?? "";
  const state   = searchParams.get("state") ?? "";

  try {
    // Build WHERE clauses for the cascade
    const conditions: string[] = [`n.user_id = $1`];
    const values: unknown[] = [session.userId];
    let i = 2;

    if (country) { conditions.push(`c.address_country ILIKE $${i}`); values.push(country); i++; }
    if (state)   { conditions.push(`c.address_state ILIKE $${i}`);   values.push(state);   i++; }

    const where = conditions.join(" AND ");

    // Single scan — collect all the columns we need in one pass
    const rows = await prisma.$queryRawUnsafe<{
      address_country: string | null;
      address_state:   string | null;
      address_city:    string | null;
      age_group:       string | null;
      gender:          string | null;
    }[]>(
      `SELECT DISTINCT
         c.address_country,
         c.address_state,
         c.address_city,
         c.age_group,
         c.gender
       FROM app.creator_notes n
       JOIN bronze.creators c ON LOWER(n.creator_id) = LOWER(c.username)
       WHERE ${where}
         AND (
           c.address_country IS NOT NULL OR
           c.address_state   IS NOT NULL OR
           c.address_city    IS NOT NULL OR
           c.age_group       IS NOT NULL OR
           c.gender          IS NOT NULL
         )`,
      ...values,
    );

    const countries = [...new Set(rows.map(r => r.address_country).filter(Boolean) as string[])].sort();
    const states    = [...new Set(rows.map(r => r.address_state).filter(Boolean)   as string[])].sort();
    const cities    = [...new Set(rows.map(r => r.address_city).filter(Boolean)    as string[])].sort();
    const ageGroups = [...new Set(rows.map(r => r.age_group).filter(Boolean)       as string[])].sort();
    const genders   = [...new Set(rows.map(r => r.gender).filter(Boolean)          as string[])].sort();

    const data: NotesMeta = { countries, states, cities, ageGroups, genders };
    return NextResponse.json(data);
  } catch (err) {
    console.error("Notes meta fetch error:", err);
    return NextResponse.json(
      { countries: [], states: [], cities: [], ageGroups: [], genders: [] },
      { status: 500 },
    );
  }
}