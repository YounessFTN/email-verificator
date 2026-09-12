"use client";

import { useCallback, useRef, useState } from "react";
import Papa from "papaparse";
import { STATUS_COLORS, STATUS_LABELS, VerifyResult } from "@/lib/types";

const GMAIL_SIGNUP_URL = "https://accounts.google.com/signup";

function extractEmailsFromCsv(text: string): string[] {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const emailRegex = /[^\s,;]+@[^\s,;]+\.[^\s,;]+/;
  const found: string[] = [];
  for (const row of parsed.data) {
    for (const cell of row) {
      const match = String(cell).trim().match(emailRegex);
      if (match) found.push(match[0]);
    }
  }
  return Array.from(new Set(found));
}

function ResultBadge({ result }: { result: VerifyResult }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[result.status]}`}
    >
      {STATUS_LABELS[result.status]}
    </span>
  );
}

function downloadCsv(results: VerifyResult[]) {
  const header = "email,statut,raison,code_smtp,serveur_mx,duree_ms\n";
  const rows = results
    .map((r) =>
      [
        r.email,
        STATUS_LABELS[r.status],
        `"${r.reason.replace(/"/g, '""')}"`,
        r.smtpCode ?? "",
        r.mxHost ?? "",
        r.durationMs,
      ].join(",")
    )
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resultats-verification.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function EmailVerifier() {
  const [singleEmail, setSingleEmail] = useState("");
  const [singleResult, setSingleResult] = useState<VerifyResult | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);

  const [batchResults, setBatchResults] = useState<VerifyResult[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const verifySingle = useCallback(async () => {
    if (!singleEmail.trim()) return;
    setSingleLoading(true);
    setSingleResult(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: singleEmail.trim() }),
      });
      const data = await res.json();
      setSingleResult(data);
    } catch {
      setSingleResult({
        email: singleEmail.trim(),
        status: "unknown",
        reason: "Erreur réseau lors de la vérification.",
        durationMs: 0,
      });
    } finally {
      setSingleLoading(false);
    }
  }, [singleEmail]);

  const handleCsvUpload = useCallback(async (file: File) => {
    const text = await file.text();
    const emails = extractEmailsFromCsv(text);
    if (emails.length === 0) {
      alert("Aucune adresse email trouvée dans ce fichier CSV.");
      return;
    }

    setBatchResults([]);
    setBatchTotal(emails.length);
    setBatchRunning(true);

    try {
      const res = await fetch("/api/verify-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });

      if (!res.body) throw new Error("Pas de flux de réponse");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const obj = JSON.parse(line);
          if (obj.type === "done") continue;
          setBatchResults((prev) => [...prev, obj as VerifyResult]);
        }
      }
    } catch (err) {
      alert("Erreur pendant la vérification en masse: " + String(err));
    } finally {
      setBatchRunning(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-12 w-full max-w-2xl">
      <header className="flex flex-col gap-3 text-center sm:text-left">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Vérificateur d&apos;adresses email
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Vérifie si une adresse email existe réellement via un handshake SMTP direct auprès du
          serveur mail du destinataire, sans envoyer de message.
        </p>
        <a
          href={GMAIL_SIGNUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 self-center sm:self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Créer une adresse Gmail
        </a>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          Vérifier une adresse
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            placeholder="exemple@gmail.com"
            value={singleEmail}
            onChange={(e) => setSingleEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && verifySingle()}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            onClick={verifySingle}
            disabled={singleLoading || !singleEmail.trim()}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {singleLoading ? "Vérification…" : "Vérifier"}
          </button>
        </div>

        {singleResult && (
          <div className="mt-2 flex flex-col gap-2 rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
            <div className="flex items-center gap-2">
              <span className="font-mono text-zinc-800 dark:text-zinc-200">
                {singleResult.email}
              </span>
              <ResultBadge result={singleResult} />
            </div>
            <p className="text-zinc-600 dark:text-zinc-400">{singleResult.reason}</p>
            {singleResult.mxHost && (
              <p className="text-xs text-zinc-400">
                Serveur MX: {singleResult.mxHost} · {singleResult.durationMs}ms
              </p>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
            Vérification en masse (CSV)
          </h2>
          {batchResults.length > 0 && !batchRunning && (
            <button
              onClick={() => downloadCsv(batchResults)}
              className="text-sm font-medium text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Télécharger les résultats
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleCsvUpload(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={batchRunning}
          className="w-fit rounded-lg border border-dashed border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          {batchRunning ? "Import en cours…" : "Importer un fichier CSV"}
        </button>

        {batchTotal > 0 && (
          <p className="text-xs text-zinc-500">
            {batchResults.length} / {batchTotal} adresses vérifiées
          </p>
        )}

        {batchResults.length > 0 && (
          <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    Email
                  </th>
                  <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    Statut
                  </th>
                </tr>
              </thead>
              <tbody>
                {batchResults.map((r, i) => (
                  <tr key={r.email + i} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200">
                      {r.email}
                    </td>
                    <td className="px-3 py-2">
                      <ResultBadge result={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
