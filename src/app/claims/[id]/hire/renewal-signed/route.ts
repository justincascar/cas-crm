import { uploadSignedRenewal } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

/** The signed hire agreement renewal. The renewal is marked signed on the day it is filed. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, async ({ id, staffId, form, key }) => {
    const file = form.get("signedRenewal");
    if (!(file instanceof File) || file.size < 1) throw new Error("Choose the signed renewal to upload.");
    uploadSignedRenewal({
      claimId: id,
      actorId: staffId,
      submitKey: key,
      file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name || "signed-renewal.pdf", mimeType: file.type || "" },
    });
    return { hash: "#on-hire" };
  });
}
