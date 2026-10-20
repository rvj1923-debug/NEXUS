import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { isRemoteAgentDeployment } from "@/lib/deployment";

const pairSchema = z.object({
  readerId: z.string().optional(),
  readerIdentifier: z.string().optional(),
  kioskIdentifier: z.string().min(2, "Kiosk identifier is required"),
  pairingSecret: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (session instanceof NextResponse) {
      return session;
    }

    const body = await req.json();
    const parsed = pairSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { readerId, readerIdentifier, kioskIdentifier, pairingSecret } = parsed.data;

    let reader = null;
    if (readerId) {
      reader = await db.nfcReader.findUnique({ where: { id: readerId } });
    } else if (readerIdentifier) {
      reader = await db.nfcReader.findUnique({ where: { readerIdentifier } });
    }

    // Attempt pairing handshake with local agent if available
    let agentPaired = false;
    let agentToken: string | null = null;

    try {
      const effectiveSecret = (pairingSecret || process.env.AGENT_PAIRING_SECRET || "").trim();
      // Central server deployment: the agent runs on each kiosk PC, not on this server
      if (effectiveSecret && !isRemoteAgentDeployment()) {
        const res = await fetch("http://127.0.0.1:8002/api/agent/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: effectiveSecret,
            kioskIdentifier,
          }),
        });
        if (res.ok) {
          const agentData = await res.json();
          agentPaired = true;
          agentToken = agentData.token || null;
        }
      }
    } catch (e) {
      // Local agent might not be running on remote client, which is acceptable
      agentPaired = false;
    }

    if (reader) {
      reader = await db.nfcReader.update({
        where: { id: reader.id },
        data: {
          pairedKiosk: kioskIdentifier,
          status: "ONLINE",
          lastHeartbeatAt: new Date(),
        },
      });

      await recordAuditLog({
        userId: session?.userId,
        userEmail: session?.email,
        userRole: session?.roleCode,
        action: "READER_PAIRED",
        entityType: "NFC_READER",
        entityId: reader.id,
        changes: { pairedKiosk: kioskIdentifier, agentPaired },
      });
    }

    return NextResponse.json({
      success: true,
      pairedKiosk: kioskIdentifier,
      agentPaired,
      agentToken,
      reader: reader
        ? {
            id: reader.id,
            readerIdentifier: reader.readerIdentifier,
            name: reader.name,
            pairedKiosk: reader.pairedKiosk,
          }
        : null,
      message: `Successfully paired kiosk '${kioskIdentifier}' with ${reader ? reader.name : "local reader subsystem"}.`,
    });
  } catch (error: any) {
    console.error("[POST /api/readers/pair] Error:", error);
    return NextResponse.json(
      { error: "Failed to pair reader", details: error.message },
      { status: 500 }
    );
  }
}
