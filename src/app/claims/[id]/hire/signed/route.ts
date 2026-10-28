import { uploadSignedHireAgreement } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, async ({ id, staffId, form, key }) => {
    const file = form.get("signedAgreement");
    if (!(file instanceof File) || file.size < 1) throw new Error("Choose the signed hire agreement to upload.");
    uploadSignedHireAgreement({
      claimId: id,
      actorId: staffId,
      submitKey: key,
      file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name || "signed-hire-agreement.pdf", mimeType: file.type || "" },
    });
    return { hash: "#on-hire" };
  });
}
