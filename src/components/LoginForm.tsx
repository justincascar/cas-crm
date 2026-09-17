"use client";

import { useState } from "react";
import { actionLogin } from "@/app/auth-actions";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await actionLogin(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />
      <label className="block text-sm">
        Username
        <input className={field} name="username" autoComplete="username" required autoFocus />
      </label>
      <label className="block text-sm">
        Password
        <input className={field} name="password" type="password" autoComplete="current-password" required />
      </label>
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm text-overdue">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
