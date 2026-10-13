import { LIVE_EMAIL_BANNER, SIMULATED_EMAIL_BANNER } from "./send-mode-copy";

/** Server-side switch. Do not import this file from a client component. */
export const EMAIL_SEND_MODE_ENV = "EMAIL_SEND_MODE";

export type EmailSendMode = "simulate" | "live";

/**
 * Live only when the variable is exactly "live".
 * Missing, empty, or any other value — including when Microsoft 365 credentials are set — is simulate.
 */
export function emailSendMode(): EmailSendMode {
  return process.env[EMAIL_SEND_MODE_ENV] === "live" ? "live" : "simulate";
}

export function liveEmailSending(): boolean {
  return emailSendMode() === "live";
}

export function emailSendBanner(): { mode: EmailSendMode; text: string } {
  const mode = emailSendMode();
  return {
    mode,
    text: mode === "live" ? LIVE_EMAIL_BANNER : SIMULATED_EMAIL_BANNER,
  };
}
