"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/session";
import {
  cancelEngineerInstructionChase,
  pauseEngineerInstructionChase,
  resumeEngineerInstructionChase,
} from "@/lib/db/engineer-chase";
import {
  clearEngineerReportReceived,
  logEngineerReportReceived,
  markEngineerReportChaseSent,
  prepareEngineerReportChase,
  recordClaimEvent,
} from "@/lib/db/chronology";

function refreshClaim(claimId: string) {
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath(`/claims/${claimId}/work/history`);
  revalidatePath("/claims");
  revalidatePath("/");
}

export async function actionPrepareEngineerReportChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const result = prepareEngineerReportChase({ claimId, actorId: staff.id });
    refreshClaim(claimId);
    return { error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not prepare the chase email." };
  }
}

export async function actionMarkEngineerReportChaseSent(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const result = markEngineerReportChaseSent({
      claimId,
      correspondenceId: String(formData.get("correspondenceId") || ""),
      actorId: staff.id,
      occurredAt: String(formData.get("occurredAt") || "") || undefined,
    });
    refreshClaim(claimId);
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not mark the chase as sent." };
  }
}

export async function actionLogEngineerReportReceived(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const result = logEngineerReportReceived({
      claimId,
      actorId: staff.id,
      occurredAt: String(formData.get("occurredAt") || "") || undefined,
    });
    refreshClaim(claimId);
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not log the engineer report." };
  }
}

export async function actionClearEngineerReportReceived(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const result = clearEngineerReportReceived({
      claimId,
      actorId: staff.id,
      occurredAt: String(formData.get("occurredAt") || "") || undefined,
    });
    refreshClaim(claimId);
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not clear the report receipt." };
  }
}

export async function actionPauseEngineerChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    pauseEngineerInstructionChase(claimId);
    recordClaimEvent({
      claimId,
      eventType: "engineer_chase_paused",
      occurredAt: new Date().toISOString(),
      details: `Engineer report chase paused by ${staff.name}. Last action taken wins if two people save at once.`,
      actorId: staff.id,
      channel: "file",
      source: "staff",
    });
    refreshClaim(claimId);
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not pause the chase." };
  }
}

export async function actionResumeEngineerChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    resumeEngineerInstructionChase(claimId);
    recordClaimEvent({
      claimId,
      eventType: "engineer_chase_resumed",
      occurredAt: new Date().toISOString(),
      details: `Engineer report chase resumed by ${staff.name}. Interval follows the current Settings value.`,
      actorId: staff.id,
      channel: "file",
      source: "staff",
    });
    refreshClaim(claimId);
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not resume the chase." };
  }
}

export async function actionCancelEngineerChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    cancelEngineerInstructionChase(claimId);
    recordClaimEvent({
      claimId,
      eventType: "engineer_chase_cancelled",
      occurredAt: new Date().toISOString(),
      details: `Engineer report chase cancelled by ${staff.name}. It will not show as due unless the engineer is instructed again.`,
      actorId: staff.id,
      channel: "file",
      source: "staff",
    });
    refreshClaim(claimId);
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not cancel the chase." };
  }
}
