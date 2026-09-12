import { promises as dns, MxRecord } from "dns";
import net from "net";
import disposableDomains from "disposable-email-domains";
import type { VerifyResult } from "@/lib/types";

const DISPOSABLE_SET = new Set(disposableDomains);

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const SMTP_TIMEOUT_MS = 8000;
const HELO_DOMAIN = process.env.SMTP_HELO_DOMAIN || "verifier.local";
const MAIL_FROM = process.env.SMTP_MAIL_FROM || "probe@verifier.local";

function randomLocalPart(): string {
  return "no-such-user-" + Math.random().toString(36).slice(2, 12);
}

interface SmtpSession {
  socket: net.Socket;
  send(line: string): Promise<{ code: number; message: string }>;
  close(): void;
}

function readOneResponse(socket: net.Socket): Promise<{ code: number; message: string }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      // Multi-line SMTP responses use "250-" until the final "250 "
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        const code = parseInt(last.slice(0, 3), 10);
        resolve({ code, message: buffer.trim() });
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function openSmtpSession(host: string): Promise<SmtpSession> {
  const socket = net.createConnection({ host, port: 25 });

  // Idle timeout covers the whole session (connect + every subsequent
  // command/response), resetting on any activity. Destroying with an
  // error turns it into a normal 'error' event so callers can catch it.
  socket.setTimeout(SMTP_TIMEOUT_MS);
  socket.on("timeout", () => {
    socket.destroy(new Error(`Délai dépassé (${SMTP_TIMEOUT_MS}ms) en parlant à ${host}`));
  });
  // Safety net: guarantees at least one 'error' listener always exists,
  // so a stray error after a stage-specific listener has been removed
  // (e.g. the OS reporting ETIMEDOUT after our own timeout already fired)
  // never crashes the process with an unhandled 'error' event.
  socket.on("error", () => {});

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onErr);
    };
    socket.on("connect", onConnect);
    socket.on("error", onErr);
  });

  // consume the 220 greeting
  await readOneResponse(socket);

  const send = async (line: string) => {
    socket.write(line + "\r\n");
    return readOneResponse(socket);
  };

  return {
    socket,
    send,
    close: () => {
      try {
        socket.end();
      } catch {
        // ignore
      }
      socket.destroy();
    },
  };
}

async function checkAddressOnHost(
  host: string,
  email: string
): Promise<{ realCode: number; realMsg: string; catchAllAccepted: boolean }> {
  const session = await openSmtpSession(host);
  try {
    await session.send(`HELO ${HELO_DOMAIN}`);
    await session.send(`MAIL FROM:<${MAIL_FROM}>`);
    const real = await session.send(`RCPT TO:<${email}>`);

    let catchAllAccepted = false;
    if (real.code === 250) {
      const domain = email.split("@")[1];
      const probe = `${randomLocalPart()}@${domain}`;
      try {
        const probeResult = await session.send(`RCPT TO:<${probe}>`);
        catchAllAccepted = probeResult.code === 250;
      } catch {
        // if the probe fails for connection reasons, assume not catch-all
        catchAllAccepted = false;
      }
    }

    await session.send("QUIT").catch(() => undefined);
    return { realCode: real.code, realMsg: real.message, catchAllAccepted };
  } finally {
    session.close();
  }
}

export async function verifyEmail(rawEmail: string): Promise<VerifyResult> {
  const start = Date.now();
  const email = rawEmail.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    return {
      email,
      status: "syntax_invalid",
      reason: "Format d'adresse invalide.",
      durationMs: Date.now() - start,
    };
  }

  const domain = email.split("@")[1];

  if (DISPOSABLE_SET.has(domain)) {
    return {
      email,
      status: "disposable",
      reason: "Domaine d'email jetable/temporaire connu.",
      durationMs: Date.now() - start,
    };
  }

  let mxRecords: MxRecord[];
  try {
    mxRecords = await dns.resolveMx(domain);
  } catch {
    mxRecords = [];
  }

  if (!mxRecords || mxRecords.length === 0) {
    return {
      email,
      status: "no_mx",
      reason: "Le domaine n'a aucun serveur mail (MX) configuré.",
      durationMs: Date.now() - start,
    };
  }

  mxRecords.sort((a, b) => a.priority - b.priority);

  let lastError: string | undefined;
  for (const mx of mxRecords) {
    try {
      const { realCode, realMsg, catchAllAccepted } = await checkAddressOnHost(
        mx.exchange,
        email
      );

      if (realCode === 250 && catchAllAccepted) {
        return {
          email,
          status: "catch_all",
          reason:
            "Le serveur mail accepte toutes les adresses de ce domaine (catch-all) : impossible de confirmer l'existence exacte de la boîte.",
          smtpCode: realCode,
          mxHost: mx.exchange,
          durationMs: Date.now() - start,
        };
      }

      if (realCode === 250) {
        return {
          email,
          status: "valid",
          reason: "Le serveur mail confirme que cette boîte existe.",
          smtpCode: realCode,
          mxHost: mx.exchange,
          durationMs: Date.now() - start,
        };
      }

      if (realCode >= 500 && realCode < 600) {
        return {
          email,
          status: "invalid",
          reason: realMsg.split("\r\n").pop() || "Adresse rejetée par le serveur mail.",
          smtpCode: realCode,
          mxHost: mx.exchange,
          durationMs: Date.now() - start,
        };
      }

      // 4xx: temporary failure (greylisting) — try next MX or report unknown
      lastError = `Code temporaire ${realCode}: ${realMsg}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // try next MX host
    }
  }

  return {
    email,
    status: "unknown",
    reason:
      lastError ||
      "Impossible de joindre les serveurs mail (greylisting, blocage réseau, ou délai dépassé). Réessayez plus tard.",
    durationMs: Date.now() - start,
  };
}
