import { IntakeForm } from "@/components/IntakeForm";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { listStaff, nextReference } from "@/lib/db/queries";

export default async function NewClaimPage() {
  await requireStaff();
  const staff = listStaff().map((s) => ({ id: String(s.id), name: String(s.name) }));
  const previewRef = nextReference();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New claim"
        subtitle="Capture client, vehicle, accident, recovery and third-party details. The next demonstration reference is shown on the form."
      />
      <IntakeForm staff={staff} nextRef={previewRef} />
    </div>
  );
}
