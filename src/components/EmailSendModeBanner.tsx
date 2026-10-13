import { emailSendBanner } from "@/lib/email/send-mode";

/** Persistent sending notice. The wording comes only from EMAIL_SEND_MODE. */
export function EmailSendModeBanner() {
  const banner = emailSendBanner();
  const live = banner.mode === "live";
  return (
    <p
      role="status"
      className={
        live
          ? "rounded-md border-4 border-[#3d0a0a] bg-overdue px-4 py-3 text-base font-bold text-white"
          : "rounded-md border-4 border-navy bg-[#d9e4ef] px-4 py-3 text-base font-bold text-navy-deep"
      }
    >
      {banner.text}
    </p>
  );
}
