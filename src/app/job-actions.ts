"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn, requireStaff } from "@/lib/auth/session";
import { addRepairEvidence, assignDayJob } from "@/lib/db/jobs";
import { errorQuery } from "@/lib/form-validation";

async function fileFromField(formData: FormData, field: string) {
  const value = formData.get(field);
  if (!value || typeof value === "string" || value.size === 0) return null;
  return {
    buffer: Buffer.from(await value.arrayBuffer()),
    filename: value.name || "repair",
    mimeType: value.type || "",
  };
}

export async function actionAssignDayJob(formData: FormData) {
  const staff = await requireStaff();
  try {
    assignDayJob({
      assigneeId: String(formData.get("assigneeId") || ""),
      jobKind: String(formData.get("jobKind") || ""),
      claimId: String(formData.get("claimId") || ""),
      hireEpisodeId: String(formData.get("hireEpisodeId") || ""),
      actorId: staff.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The job could not be assigned.";
    redirect(`/jobs${errorQuery(message)}`);
  }
  revalidatePath("/jobs");
  redirect("/jobs?saved=1");
}

export async function actionAddRepairEvidence(formData: FormData) {
  const staff = await requireSignedIn();
  const claimId = String(formData.get("claimId") || "");
  try {
    const camera = await fileFromField(formData, "camera");
    const existing = await fileFromField(formData, "file");
    if (camera && existing) throw new Error("Choose either a new photograph or an existing file, not both.");
    const file = camera || existing;
    if (!file) throw new Error("Choose a file.");
    addRepairEvidence({
      claimId,
      actorId: staff.id,
      actorRole: staff.role,
      kind: String(formData.get("kind") || ""),
      note: String(formData.get("note") || ""),
      file,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file could not be saved.";
    redirect(`/claims/${claimId}/repair${errorQuery(message)}`);
  }
  revalidatePath(`/claims/${claimId}/repair`);
  redirect(`/claims/${claimId}/repair?saved=1`);
}
