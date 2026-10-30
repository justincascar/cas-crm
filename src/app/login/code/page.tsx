import { cookies } from "next/headers";
import Link from "next/link";
import { CHALLENGE_COOKIE, readChallenge } from "@/lib/auth/login-security";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base tracking-[0.3em]";

/** The second sign-in step: the six-digit code from the authenticator app. */
export default async function LoginCodePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const challenge = readChallenge((await cookies()).get(CHALLENGE_COOKIE)?.value);
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <div className="rounded-xl border border-line bg-card p-8">
        <p className="font-serif text-3xl text-navy-deep">CAS</p>
        <h1 className="mt-1 text-lg font-semibold">Code from your authenticator app</h1>
        {error ? <p data-form-error className="mt-3 rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm text-overdue">{error}</p> : null}
        {challenge ? (
          <form method="post" action="/login/code/submit" className="mt-4 space-y-4">
            <input type="hidden" name="step" value="code" />
            <label className="block text-sm">
              Six-digit code
              <input className={field} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
            </label>
            <button type="submit" className="w-full rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white">
              Continue
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm">
            This sign-in step has expired.{" "}
            <Link href="/login" className="text-teal-dark underline">
              Sign in again
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
