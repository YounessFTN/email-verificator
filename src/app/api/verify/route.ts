import { NextRequest, NextResponse } from "next/server";
import { verifyEmail } from "@/lib/smtp-verify";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = body?.email;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Le champ 'email' est requis." }, { status: 400 });
  }

  const result = await verifyEmail(email);
  return NextResponse.json(result);
}
