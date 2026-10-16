import { emailSendBanner } from "@/lib/email/send-mode";

/**
 * Live-mode warning on a sending screen. The wording comes only from EMAIL_SEND_MODE.
 * In simulate mode the app shell already shows the banner, so this renders nothing.
 */
export function EmailSendModeBanner() {
  const banner = emailSendBanner();
  if (banner.mode !== "live") return null;
  return (
    <p role="status" className="rounded-md border-4 border-[#3d0a0a] bg-overdue px-4 py-3 text-base font-bold text-white">
      {banner.text}
    </p>
  );
}
