import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const username = decodeURIComponent(id);

  // Fetch the most recently analyzed row for this username
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM bronze.creators
     WHERE LOWER(username) = LOWER($1)
     ORDER BY COALESCE(analyzed_date, latest_post_date, scraped_date) DESC NULLS LAST
     LIMIT 1`,
    username
  );

  if (!rows.length) {
    return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  }

  const c = rows[0];

  // Convert all snake_case keys to camelCase and handle BigInt
  const creator: Record<string, any> = {};
  for (const [key, val] of Object.entries(c)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    creator[camelKey] = typeof val === "bigint" ? val.toString() : val;
  }

  await logAudit(session.userId, "VIEW_CREATOR", { username });

  return NextResponse.json({ creator });
}