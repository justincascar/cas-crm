const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base";

export function LoginForm({ nextPath, failed }: { nextPath: string; failed?: boolean }) {
  return (
    <form method="post" action="/login/submit" className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />
      <label className="block text-sm">
        Username
        <input className={field} name="username" autoComplete="username" required autoFocus />
      </label>
      <label className="block text-sm">
        Password
        <input className={field} name="password" type="password" autoComplete="current-password" required />
      </label>
      {failed ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm text-overdue">
          Username or password is not right.
        </p>
      ) : null}
      <button
        type="submit"
        className="w-full rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white"
      >
        Sign in
      </button>
    </form>
  );
}
