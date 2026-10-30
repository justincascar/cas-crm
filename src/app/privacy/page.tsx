import type { Metadata } from "next";
import { PRIVACY_NOTICE_APPROVED, PRIVACY_NOTICE_PLACEHOLDER } from "@/lib/documents/privacy-notice";

export const metadata: Metadata = { title: "Privacy notice" };

/** The privacy notice clients reach from the client form and the welcome email. A placeholder until J9a approves it. */
export default function PrivacyNoticePage() {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-8" data-privacy-notice={PRIVACY_NOTICE_APPROVED ? "approved" : "placeholder"}>
      <p className="text-sm text-slate">Complete Accident Solutions Ltd</p>
      <h1 className="font-serif text-2xl text-navy-deep">Privacy notice</h1>
      <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-base">{PRIVACY_NOTICE_PLACEHOLDER}</p>
    </main>
  );
}
