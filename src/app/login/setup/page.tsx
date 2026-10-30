import { cookies } from "next/headers";
import Link from "next/link";
import { CHALLENGE_COOKIE, readChallenge } from "@/lib/auth/login-security";
import { totpUri } from "@/lib/auth/totp";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base tracking-[0.3em]";

/** Setting up the authenticator app: the key to add to the app, then a code from it to prove it works. */
export default async function LoginSetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const challenge = readChallenge((await cookies()).get(CHALLENGE_COOKIE)?.value);
  const secret = challenge?.kind === "setup" ? challenge.pendingSecret : null;
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <div className="rounded-xl border border-line bg-card p-8">
        <p className="font-serif text-3xl text-navy-deep">CAS</p>
        <h1 className="mt-1 text-lg font-semibold">Set up your authenticator app</h1>
        {error ? <p data-form-error className="mt-3 rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm text-overdue">{error}</p> : null}
        {secret && challenge ? (
          <>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
              <li>Open Microsoft Authenticator, Google Authenticator or a similar app on your phone and add an account.</li>
              <li>
                Choose to enter a key, name it &quot;CAS CRM&quot; and type this key (time based):
                <span className="mt-1 block break-all rounded-md bg-white px-3 py-2 font-mono text-base" data-totp-secret={secret}>
                  {secret.match(/.{1,4}/g)?.join(" ")}
                </span>
                On the phone itself you can{" "}
                <a href={totpUri(secret, challenge.username)} className="text-teal-dark underline">
                  open this link in the app
                </a>{" "}
                instead.
              </li>
              <li>Type the six-digit code the app shows.</li>
            </ol>
            <form method="post" action="/login/code/submit" className="mt-4 space-y-4">
              <input type="hidden" name="step" value="setup" />
              <label className="block text-sm">
                Six-digit code
                <input className={field} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
              </label>
              <button type="submit" className="w-full rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white">
                Switch it on and continue
              </button>
            </form>
            <p className="mt-3 text-xs text-slate">The key is shown only during this set-up. If you lose your phone, Justin resets it in Settings.</p>
          </>
        ) : (
          <p className="mt-4 text-sm">
            This set-up step has expired.{" "}
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
