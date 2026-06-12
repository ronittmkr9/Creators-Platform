import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const itemSchema = z.object({ creatorId: z.string() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: listId } = await params;

  const list = await prisma.savedList.findFirst({ where: { id: listId, userId: session.userId } });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  try {
    await prisma.savedListItem.create({
      data: { listId, creatorId: parsed.data.creatorId },
    });
    await logAudit(session.userId, "ADD_TO_LIST", { listId, creatorId: parsed.data.creatorId });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Already in list" }, { status: 409 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: listId } = await params;
  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId");

  if (!creatorId) return NextResponse.json({ error: "creatorId required" }, { status: 400 });

  await prisma.savedListItem.deleteMany({ where: { listId, creatorId } });
  await logAudit(session.userId, "REMOVE_FROM_LIST", { listId, creatorId });

  return NextResponse.json({ success: true });
}
