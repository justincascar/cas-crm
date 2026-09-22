import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getRequestStaff, safeNextPath } from "@/lib/auth/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const staff = await getRequestStaff();
  if (staff) redirect("/");
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <div className="min-h-screen">
      <div className="border-b border-copper/30 bg-[#efe4d2] px-4 py-2 text-center text-sm text-ink">
        <strong>Prototype — fictional test data.</strong> Sign in is required. Demonstration passwords are in
        docs/AUTH-NOTES.md.
      </div>
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <div className="rounded-xl border border-line bg-card p-8 shadow-[0_1px_0_rgba(16,28,36,0.04)]">
          <p className="font-serif text-3xl text-navy-deep">CAS</p>
          <p className="mt-1 text-sm text-slate">Complete Accident Solutions — staff sign in</p>
          <p className="mt-4 text-sm text-slate">
            This system is for authorised staff only. Demonstration usernames and passwords are in{" "}
            <span className="ref">docs/AUTH-NOTES.md</span> on this PC.
          </p>
          <div className="mt-6">
            <LoginForm nextPath={nextPath} failed={error === "1"} />
          </div>
        </div>
      </div>
    </div>
  );
}
