import { formatUkDate } from "../dates";

/**
 * R48: one sentence near the top of every chaser saying when we first wrote and how often we have chased since.
 * Everything comes from the file: the first request is the request marked sent, and the chases are the chasers sent
 * or marked sent, never scheduled ones. The full list of dates stays in the chronology.
 */
export type ChaseHistory = {
  /** When the request was marked sent (the report sent at step 7, the initial letter, the payment request). */
  firstRequestAt: string;
  /** What was asked for, read after "requesting", e.g. "repair authorisation". */
  requesting: string;
  /** A substantive reply that restarted the chase. The count then runs from this date. */
  replyAt: string | null;
  /** Chasers sent since the first request, or since the reply when there is one, oldest first. */
  chasesSent: string[];
};

function occasions(n: number): string {
  return `${n} ${n === 1 ? "occasion" : "occasions"}`;
}

/** The sentence, or null when the first-request date is not on the file (it is left out rather than guessed). */
export function chaseHistorySentence(history: ChaseHistory | null): string | null {
  if (!history?.firstRequestAt || !history.requesting.trim()) return null;
  const first = formatUkDate(history.firstRequestAt);
  const count = history.chasesSent.length;
  const latest = count ? formatUkDate(history.chasesSent[count - 1]!) : "";
  if (history.replyAt) {
    const reply = formatUkDate(history.replyAt);
    return count
      ? `We first wrote to you on ${first} requesting ${history.requesting}. Since your reply of ${reply} we have chased on ${occasions(count)}, most recently on ${latest}.`
      : `We first wrote to you on ${first} requesting ${history.requesting}. Since your reply of ${reply} this remains outstanding.`;
  }
  return count
    ? `We first wrote to you on ${first} requesting ${history.requesting} and have chased on ${occasions(count)} since, most recently on ${latest}.`
    : `We wrote to you on ${first} requesting ${history.requesting} and have not yet received a response.`;
}

const REFERENCE_LINE = /^(\*\*)?(Claim ref|Our ref|Re:)/i;

/**
 * Puts the sentence in as its own paragraph straight after the greeting, or after the reference line that follows
 * it. The combined email takes each chaser's paragraphs after the greeting, so it carries the sentence once per item.
 */
export function withChaseHistory(body: string, sentence: string | null): string {
  if (!sentence) return body;
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const greeting = lines.findIndex((line) => /^Dear /.test(line.trim()));
  if (greeting < 0) return `${sentence}\n\n${body}`;
  let at = greeting + 1;
  while (at < lines.length && !lines[at]!.trim()) at += 1;
  if (at < lines.length && REFERENCE_LINE.test(lines[at]!.trim())) {
    at += 1;
    while (at < lines.length && !lines[at]!.trim()) at += 1;
  }
  return [...lines.slice(0, at), sentence, "", ...lines.slice(at)].join("\n");
}
