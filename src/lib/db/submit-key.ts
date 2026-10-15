import { nowUtcIso } from "../dates";
import { get, run } from "./connection";

/** A form submission may be recorded once. A missing key is refused. */
export class MissingSubmitKeyError extends Error {
  constructor() {
    super("This save had no one-time key. Nothing was recorded.");
    this.name = "MissingSubmitKeyError";
  }
}

/** The person must confirm before a second similar offer is recorded. Nothing has been written. */
export class SubmitNeedsConfirm extends Error {
  readonly code = "needs_confirm";

  constructor(message: string) {
    super(message);
    this.name = "SubmitNeedsConfirm";
  }
}

export function requireSubmitKey(key: string | null | undefined): string {
  const trimmed = String(key ?? "").trim();
  if (!trimmed) throw new MissingSubmitKeyError();
  return trimmed;
}

export function formSubmitKey(form: FormData): string {
  return requireSubmitKey(String(form.get("submitKey") ?? ""));
}

/** The result stored for a key that has already succeeded, if any. */
export function replaySubmit<T>(key: string): T | undefined {
  const row = get<{ result_json: string }>(`SELECT result_json FROM submit_keys WHERE submit_key = ?`, [key]);
  if (!row?.result_json) return undefined;
  try {
    return JSON.parse(row.result_json) as T;
  } catch {
    return undefined;
  }
}

export function storeSubmit(key: string, result: unknown): void {
  run(`INSERT INTO submit_keys(submit_key, result_json, created_at) VALUES (?, ?, ?)`, [
    key,
    JSON.stringify(result),
    nowUtcIso(),
  ]);
}
