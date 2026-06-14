// app/api/creators/meta/route.ts
// Returns all distinct niche, country, and city values from the creators table.
// Used to populate filter dropdowns in the dashboard.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // adjust to your prisma import path

// This data (distinct niches/countries/cities) changes rarely, but the
// underlying query scans the whole table. Cache it in memory for all users.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let cache: { data: { primaryniches: string[]; countries: string[]; cities: string[]; creatorTypes: string[]; states: string[] }; expires: number } | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.data);
  }

  try {
    const [nicheRows, countryRows, cityRows, creatorTypeRows, stateRows] = await Promise.all([
      prisma.creator.findMany({
        where: { nichePrimary: { not: null } },
        select: { nichePrimary: true },
        distinct: ["nichePrimary"],
        orderBy: { nichePrimary: "asc" },
      }),
      prisma.creator.findMany({
        where: { addressCountry: { not: null } },
        select: { addressCountry: true },
        distinct: ["addressCountry"],
        orderBy: { addressCountry: "asc" },
      }),
      prisma.creator.findMany({
        where: { addressCity: { not: null } },
        select: { addressCity: true },
        distinct: ["addressCity"],
        orderBy: { addressCity: "asc" },
      }),
      prisma.creator.findMany({
        where: { creatorType: { not: null } },
        select: { creatorType: true },
        distinct: ["creatorType"],
        orderBy: { creatorType: "asc" },
      }),
      prisma.creator.findMany({
        where: { addressState: { not: null } },
        select: { addressState: true },
        distinct: ["addressState"],
        orderBy: { addressState: "asc" },
      }),
    ]);

    const data = {
      primaryniches: nicheRows.map(r => r.nichePrimary).filter(Boolean) as string[],
      countries: countryRows.map(r => r.addressCountry).filter(Boolean) as string[],
      cities: cityRows.map(r => r.addressCity).filter(Boolean) as string[],
      creatorTypes: creatorTypeRows.map(r => r.creatorType).filter(Boolean) as string[],
      states: stateRows.map(r => r.addressState).filter(Boolean) as string[],
    };

    cache = { data, expires: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(data);
  } catch (err) {
    console.error("Meta fetch error:", err);
    return NextResponse.json({ primaryniches: [], countries: [], cities: [], creatorTypes: [], states: [] }, { status: 500 });
  }
}