"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/session";
import {
  cancelChase,
  clearChaseIntervalOverride,
  pauseChase,
  resumeChase,
  setChaseIntervalOverride,
} from "@/lib/db/chase";
import {
  clearChaseOutcome,
  logChaseOutcome,
  logRepairAuthorisationRequested,
  markOutstandingChaseSent,
  prepareOutstandingChase,
  recordClaimEvent,
} from "@/lib/db/chronology";
import { chaseDefinition, isChaseKind, type ChaseKind } from "@/lib/domain/chase";
import { optionalPoundsToPence } from "@/lib/domain/total-loss";
import { recordAgreedRepairInvoice, recordHeadPayment, recordUnreferencedPayment } from "@/lib/db/payment-ledger";

function refreshClaim(claimId: string) {
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath(`/claims/${claimId}/work/history`);
  revalidatePath("/claims");
  revalidatePath("/");
}

function kindFromForm(formData: FormData): ChaseKind {
  const kind = String(formData.get("kind") || "");
  if (!isChaseKind(kind)) throw new Error("Unknown chase type.");
  return kind;
}

export async function actionPrepareChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const result = prepareOutstandingChase({ claimId, actorId: staff.id, kind });
    refreshClaim(claimId);
    return { error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not prepare the chase email." };
  }
}

export async function actionMarkChaseSent(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const result = markOutstandingChaseSent({
      claimId,
      kind,
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

export async function actionLogChaseOutcome(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const result = logChaseOutcome({
      claimId,
      kind,
      actorId: staff.id,
      occurredAt: String(formData.get("occurredAt") || "") || undefined,
      liabilityDecision: String(formData.get("liabilityDecision") || "") || undefined,
      repairOutcome: String(formData.get("repairOutcome") || "") || undefined,
    });
    refreshClaim(claimId);
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not log the outcome." };
  }
}

export async function actionClearChaseOutcome(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const result = clearChaseOutcome({
      claimId,
      kind,
      actorId: staff.id,
      occurredAt: String(formData.get("occurredAt") || "") || undefined,
    });
    refreshClaim(claimId);
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not clear the outcome." };
  }
}

export async function actionPauseChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const def = chaseDefinition(kind);
    pauseChase(kind, claimId);
    recordClaimEvent({
      claimId,
      eventType: def.pauseEventType,
      occurredAt: new Date().toISOString(),
      details: `${def.title} paused by ${staff.name}. Last action taken wins if two people save at once.`,
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

export async function actionResumeChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const def = chaseDefinition(kind);
    resumeChase(kind, claimId);
    recordClaimEvent({
      claimId,
      eventType: def.resumeEventType,
      occurredAt: new Date().toISOString(),
      details: `${def.title} resumed by ${staff.name}.`,
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

export async function actionCancelChase(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const def = chaseDefinition(kind);
    cancelChase(kind, claimId);
    recordClaimEvent({
      claimId,
      eventType: def.cancelEventType,
      occurredAt: new Date().toISOString(),
      details: `${def.title} cancelled by ${staff.name}. It will not show as due unless the outstanding request is recorded again.`,
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

function poundsFrom(formData: FormData, name: string): number {
  const parsed = optionalPoundsToPence(String(formData.get(name) || ""));
  if (parsed == null || parsed <= 0) throw new Error("Enter the amount in pounds.");
  return parsed;
}

export async function actionRecordAgreedRepair(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    recordAgreedRepairInvoice({ claimId, actorId: staff.id, agreedPence: poundsFrom(formData, "agreed") });
    refreshClaim(claimId);
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the agreed repair invoice." };
  }
}

export async function actionLogHeadPayment(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const result = recordHeadPayment({
      claimId,
      actorId: staff.id,
      head: String(formData.get("head") || ""),
      amountPence: poundsFrom(formData, "amount"),
      correction: String(formData.get("correction") || "") === "yes",
    });
    refreshClaim(claimId);
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the payment." };
  }
}

export async function actionLogUnreferencedPayment(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const raw = String(formData.get("amount") || "").trim();
    recordUnreferencedPayment({
      claimId,
      actorId: staff.id,
      amountPence: raw ? optionalPoundsToPence(raw) : null,
      note: String(formData.get("note") || ""),
    });
    refreshClaim(claimId);
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not flag the payment." };
  }
}

export async function actionSaveChaseOverride(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const def = chaseDefinition(kind);
    setChaseIntervalOverride(kind, claimId, String(formData.get("overrideDays") || ""), String(formData.get("overrideReason") || ""));
    recordClaimEvent({
      claimId,
      eventType: "other",
      occurredAt: new Date().toISOString(),
      details: `${def.title} interval on this file set to ${String(formData.get("overrideDays") || "")} days by ${staff.name}. Reason: ${String(formData.get("overrideReason") || "")}. This does not change the global Settings value.`,
      actorId: staff.id,
      channel: "file",
      source: "staff",
    });
    refreshClaim(claimId);
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save this file's chase interval." };
  }
}

export async function actionClearChaseOverride(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const kind = kindFromForm(formData);
    const def = chaseDefinition(kind);
    clearChaseIntervalOverride(kind, claimId);
    recordClaimEvent({
      claimId,
      eventType: "other",
      occurredAt: new Date().toISOString(),
      details: `${def.title} per-file interval override cleared by ${staff.name}. This file now follows the global Settings value.`,
      actorId: staff.id,
      channel: "file",
      source: "staff",
    });
    refreshClaim(claimId);
    return { ok: true as const };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not clear this file's chase interval." };
  }
}

export async function actionLogRepairAuthorisationRequested(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const result = logRepairAuthorisationRequested({
      claimId,
      actorId: staff.id,
      occurredAt: String(formData.get("occurredAt") || "") || undefined,
    });
    refreshClaim(claimId);
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not log the repair authorisation request." };
  }
}
