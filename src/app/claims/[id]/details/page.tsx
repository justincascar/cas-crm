import { ClaimDetailsBody } from "@/components/claims/ClaimDetailsBody";

export default function ClaimDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    tlError?: string;
    tlMail?: string;
    mailboxError?: string;
    mailboxSent?: string;
    mailboxSimulated?: string;
    mailboxReport?: string;
    paymentDecision?: string;
    stepError?: string;
    stepSaved?: string;
    clash?: string;
    nextWarning?: string;
  }>;
}) {
  return <ClaimDetailsBody params={params} searchParams={searchParams} />;
}
