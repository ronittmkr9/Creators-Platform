// app/api/creators/meta/route.ts
// Returns all distinct niche, country, and city values from the creators table.
// Used to populate filter dropdowns in the dashboard.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // adjust to your prisma import path

export async function GET() {
  try {
    const [nicheRows, countryRows, cityRows] = await Promise.all([
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
    ]);

    return NextResponse.json({
      primaryniches: nicheRows.map(r => r.nichePrimary).filter(Boolean),
      countries: countryRows.map(r => r.addressCountry).filter(Boolean),
      cities: cityRows.map(r => r.addressCity).filter(Boolean),
    });
  } catch (err) {
    console.error("Meta fetch error:", err);
    return NextResponse.json({ primaryniches: [], countries: [], cities: [] }, { status: 500 });
  }
}