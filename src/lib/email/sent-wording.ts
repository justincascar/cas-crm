import { CAS_CLAIMS_MAILBOX } from "../constants";

export function mailboxSentDetails(subject: string, to: string, handlerName: string): string {
  return `${subject} sent to ${to} from ${CAS_CLAIMS_MAILBOX} by ${handlerName}.`;
}
