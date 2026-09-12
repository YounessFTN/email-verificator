import { NextRequest } from "next/server";
import { verifyEmail } from "@/lib/smtp-verify";
import type { VerifyResult } from "@/lib/types";

export const maxDuration = 300;

const CONCURRENCY = 4;
const MAX_EMAILS = 2000;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i], i);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const emails: unknown = body?.emails;

  if (!Array.isArray(emails) || emails.length === 0) {
    return new Response(JSON.stringify({ error: "Le champ 'emails' doit être un tableau non vide." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const uniqueEmails = Array.from(
    new Set(emails.filter((e): e is string => typeof e === "string" && e.trim().length > 0))
  ).slice(0, MAX_EMAILS);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (obj: VerifyResult | { type: "done"; total: number }) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      await runWithConcurrency(uniqueEmails, CONCURRENCY, async (email) => {
        try {
          const result = await verifyEmail(email);
          send(result);
        } catch (err) {
          send({
            email,
            status: "unknown",
            reason: err instanceof Error ? err.message : "Erreur inconnue",
            durationMs: 0,
          });
        }
      });

      send({ type: "done", total: uniqueEmails.length });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}
