import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const noteSchema = z.object({
  isOnboarded:    z.boolean().default(false),
  campaignNiches: z.array(z.string()).default([]),
  note:           z.string().max(2000).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: creatorId } = await params;

  const existing = await prisma.creatorNote.findUnique({
    where: { creatorId_userId: { creatorId, userId: session.userId } },
  });

  return NextResponse.json({ note: existing ?? null });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: creatorId } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const { isOnboarded, campaignNiches, note } = parsed.data;

  const saved = await prisma.creatorNote.upsert({
    where: { creatorId_userId: { creatorId, userId: session.userId } },
    create: { creatorId, userId: session.userId, isOnboarded, campaignNiches, note },
    update: { isOnboarded, campaignNiches, note, updatedAt: new Date() },
  });

  await logAudit(session.userId, "NOTE", { creatorId, action: "upsert" });

  return NextResponse.json({ note: saved });
}
