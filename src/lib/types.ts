export type VerifyStatus =
  | "valid"
  | "invalid"
  | "catch_all"
  | "disposable"
  | "no_mx"
  | "syntax_invalid"
  | "unknown";

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  reason: string;
  smtpCode?: number;
  mxHost?: string;
  durationMs: number;
}

export const STATUS_LABELS: Record<VerifyStatus, string> = {
  valid: "Existe",
  invalid: "N'existe pas",
  catch_all: "Incertain (catch-all)",
  disposable: "Jetable",
  no_mx: "Domaine invalide",
  syntax_invalid: "Format invalide",
  unknown: "Indéterminé",
};

export const STATUS_COLORS: Record<VerifyStatus, string> = {
  valid: "bg-emerald-100 text-emerald-800 border-emerald-300",
  invalid: "bg-red-100 text-red-800 border-red-300",
  catch_all: "bg-amber-100 text-amber-800 border-amber-300",
  disposable: "bg-orange-100 text-orange-800 border-orange-300",
  no_mx: "bg-red-100 text-red-800 border-red-300",
  syntax_invalid: "bg-zinc-200 text-zinc-700 border-zinc-300",
  unknown: "bg-slate-100 text-slate-700 border-slate-300",
};
