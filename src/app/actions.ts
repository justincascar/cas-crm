"use server";

import { saveClaimDraft } from "@/lib/db/claim-drafts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import {
  addNote,
  addTask,
  completeTask,
  createReservation,
  updateClaimAudatexCodes,
  updateClaimPosition,
  updateClaimWorkflowStatus,
} from "@/lib/db/queries";
import { createClaimFromIntake, intakeFieldErrors, intakeFromFormData } from "@/lib/db/intake";
import { run } from "@/lib/db/connection";
import { insertStoredDocument } from "@/lib/db/documents-store";
import { storeFileCopy } from "@/lib/storage/files";
import { complianceLookup } from "@/lib/lookups/compliance";
import {
  generateClaimDocument,
  instructEngineer,
  letterPreview,
  logIncomingEmail,
  logIncomingWhatsApp,
  markEngineerInstructionSent,
  recordClaimCall,
  recordClaimEvent,
  sendClaimEmail,
  requestScenePhotosWhatsApp,
  sendClaimWhatsApp,
} from "@/lib/db/chronology";
import { guardGenericHistoryRepairStep } from "@/lib/db/repair-progress";
import { guardStorageRecoveryClaim } from "@/lib/db/storage-recovery-signing";
import { generateHirePackDocument, generateStorageRecoveryDocument, getHirePack, saveHirePack } from "@/lib/db/hire-pack";
import { generateHireAgreementDocument, prepareHireRating } from "@/lib/db/hire-agreement";
import { currentHireEpisode } from "@/lib/db/hire-readiness";
import { normaliseGtaGroup } from "@/lib/documents/gta";
import { formLoaded, formVersion, pathWithClash, postedVersion, VersionConflictError, claimSectionForSave, withImmediateTransaction, withSectionSave, writeScreenIfCurrent } from "@/lib/db/record-version";
import { saveScreenData, valuesFromForm } from "@/lib/db/screens";
import { saveClaimOverview } from "@/lib/db/claim-facts";
import {
  SHARED_CLIENT_GTA,
  SHARED_CLIENT_PERSON,
  clientGtaGroup,
  clientPersonColumns,
  guardSharedFields,
} from "@/lib/db/shared-fields";
import { syncRecoveryClaimed, syncStorageClaimed } from "@/lib/db/storage-charge";
import { isoDaysFromNow } from "@/lib/dates";
import { postcodeLookup } from "@/lib/lookups/postcode";
import { VEHICLE_MANUAL_HINT, vehicleLookup } from "@/lib/lookups/vehicle";
import { generationMarksStep, isDocumentTemplateKey } from "@/lib/documents/catalog";
import { errorQuery, FieldValidationError, problemsQuery } from "@/lib/form-validation";
import { phoneFieldError } from "@/lib/phone-number";
import { redirectClash } from "@/lib/http/version-clash";
import { setClaimEngineer } from "@/lib/db/engineers";

export async function actionCreateClaim(formData: FormData) {
  const staff = await requireStaff();
  const input = intakeFromFormData(formData);
  const problems = intakeFieldErrors(input);
  // R56: what was typed is kept in the draft before staff are sent back to fix the problems.
  if (problems.length) {
    redirect(`/claims/new${problemsQuery(problems, { draft: keepTypedInDraft(formData, staff.id) })}`);
  }
  let result: { id: string };
  try {
    result = await createClaimFromIntake(input);
    const receipt = formData.get("inheritedReceipt");
    if (receipt instanceof File && receipt.size > 0 && input.recovery?.inherited) {
      const stored = storeFileCopy({
        relDir: `${result.id}/receipts`,
        originalFilename: receipt.name || "inherited-recovery-receipt",
        buffer: Buffer.from(await receipt.arrayBuffer()),
      });
      const documentId = insertStoredDocument({
        title: "Inherited recovery receipt",
        documentType: "inherited_recovery_receipt",
        claimId: result.id,
        originalFilename: receipt.name || "inherited-recovery-receipt",
        storedRelpath: stored.storedRelpath,
        mimeType: receipt.type || "application/octet-stream",
        byteSize: stored.byteSize,
        createdBy: input.handlerId,
      });
      run(`UPDATE recovery_jobs SET receipt_document_id = ? WHERE claim_id = ?`, [documentId, result.id]);
    }
  } catch (error) {
    const draft = keepTypedInDraft(formData, staff.id);
    if (error instanceof FieldValidationError) {
      redirect(`/claims/new${problemsQuery([{ field: error.field, message: error.message }], { draft })}`);
    }
    const message = error instanceof Error ? error.message : "Could not create the claim.";
    const field = /forename or surname/i.test(message) ? "client_forename" : undefined;
    redirect(`/claims/new${field ? problemsQuery([{ field, message }], { draft }) : `${errorQuery(message)}${draft ? `&draft=${encodeURIComponent(draft)}` : ""}`}`);
  }
  revalidatePath("/");
  revalidatePath("/claims");
  redirect(`/claims/${result.id}`);
}

/** Saves the submitted boxes into the claim draft (a new one if there is none). Returns the draft to reopen. */
function keepTypedInDraft(formData: FormData, actorId: string): string {
  const fields: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string" || name.startsWith("$ACTION") || name === "submitKey") continue;
    fields[name] = name in fields ? `${fields[name]},${value}` : value;
  }
  const draftId = String(formData.get("draftId") || "");
  try {
    return saveClaimDraft({ draftId, expectedVersion: String(formData.get("draftVersion") || ""), payload: fields, actorId }).id;
  } catch {
    // Someone else saved the draft meanwhile: theirs is kept, and staff reopen it.
    return draftId;
  }
}

export async function actionAddNote(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const body = String(formData.get("body") || "").trim();
  if (!body) return { error: "Note cannot be empty." };
  addNote(claimId, String(formData.get("authorId") || "staff-sian"), body);
  revalidatePath(`/claims/${claimId}`);
  return { ok: true };
}

export async function actionAddTask(formData: FormData) {
  await requireStaff();
  addTask({
    claimId: String(formData.get("claimId")),
    handlerId: String(formData.get("handlerId") || "staff-sian"),
    title: String(formData.get("title") || "").trim(),
    details: String(formData.get("details") || "").trim() || undefined,
    type: String(formData.get("type") || "general"),
    dueAt: String(formData.get("dueAt") || "") || undefined,
  });
  revalidatePath("/tasks");
  revalidatePath(`/claims/${String(formData.get("claimId"))}`);
  return { ok: true };
}

export async function actionCompleteTask(formData: FormData) {
  await requireStaff();
  completeTask(String(formData.get("taskId")));
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true };
}

const CLAIM_FACT_FIELDS = [
  "current_position",
  "circumstances",
  "accident_location",
  "cas_liability_assessment",
  "insurer_liability_position",
  "roadworthiness_reasons",
  "next_action",
  "next_action_due",
  "handler_id",
  "own_insurer_name",
  "own_policy_ref",
  "own_claim_ref",
  "own_insurer_address",
  "own_insurer_postcode",
] as const;

export async function actionUpdateClaim(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("claimId"));
  const submitted: Record<string, string> = {};
  for (const name of CLAIM_FACT_FIELDS) submitted[name] = String(formData.get(name) || "");
  try {
    saveClaimOverview({
      claimId: id,
      actorId: staff.id,
      submitted,
      overviewVersion: formVersion(formData),
      circumstancesVersion: postedVersion(formData, "circumstancesVersion"),
      ownInsurerVersion: postedVersion(formData, "ownInsurerVersion"),
      insurerPositionVersion: postedVersion(formData, "insurerPositionVersion"),
    });
  } catch (error) {
    if (error instanceof VersionConflictError) redirect(pathWithClash(`/claims/${id}`, error));
    throw error;
  }
  revalidatePath(`/claims/${id}`);
  revalidatePath("/");
  return { ok: true };
}

export async function actionUpdateClaimStatus(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("claimId"));
  const field = String(formData.get("field") || "");
  const liabilityStatus = String(formData.get("liabilityStatus") || "");
  const roadworthiness = String(formData.get("roadworthiness") || "");
  const splitTpPercent = String(formData.get("splitTpPercent") || "");
  try {
    withImmediateTransaction(() => {
      if (field === "liability") {
        writeScreenIfCurrent({
          claimId: id,
          screenKey: "general",
          expected: formVersion(formData),
          actorId: staff.id,
          stored: { typeOfClaim: liabilityStatus, splitTpPercent: liabilityStatus === "split" ? splitTpPercent : "" },
          labels: { typeOfClaim: "Liability status", splitTpPercent: "Third party's share" },
        });
        updateClaimWorkflowStatus(id, { liabilityStatus, splitTpPercent }, staff.id);
      } else if (field === "roadworthiness") {
        writeScreenIfCurrent({
          claimId: id,
          screenKey: "general",
          expected: formVersion(formData),
          actorId: staff.id,
          stored: { roadworthiness },
          labels: { roadworthiness: "Roadworthiness" },
        });
        updateClaimWorkflowStatus(id, { roadworthiness }, staff.id);
      }
    });
  } catch (error) {
    if (error instanceof VersionConflictError) redirect(pathWithClash(`/claims/${id}`, error));
    throw error;
  }
  revalidatePath(`/claims/${id}`);
  revalidatePath(`/claims/${id}/work/general`);
  revalidatePath(`/claims/${id}`, "layout");
  revalidatePath("/");
  return { ok: true };
}

export async function actionUpdateAudatexCodes(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("claimId"));
  const field = String(formData.get("field") || "");
  const audatexNetworkCode = String(formData.get("audatexNetworkCode") || "");
  const audatexWorkProviderCode = String(formData.get("audatexWorkProviderCode") || "");
  try {
    withImmediateTransaction(() => {
      if (field === "network") {
        writeScreenIfCurrent({
          claimId: id,
          screenKey: "insurer",
          expected: formVersion(formData),
          actorId: staff.id,
          stored: { audatexNetworkCode },
          labels: { audatexNetworkCode: "Audatex network code" },
        });
        updateClaimAudatexCodes(id, { audatexNetworkCode }, staff.id);
      } else if (field === "provider") {
        writeScreenIfCurrent({
          claimId: id,
          screenKey: "insurer",
          expected: formVersion(formData),
          actorId: staff.id,
          stored: { audatexWorkProviderCode },
          labels: { audatexWorkProviderCode: "Audatex work provider code" },
        });
        updateClaimAudatexCodes(id, { audatexWorkProviderCode }, staff.id);
      }
    });
  } catch (error) {
    if (error instanceof VersionConflictError) redirect(pathWithClash(`/claims/${id}/vehicles`, error));
    throw error;
  }
  revalidatePath(`/claims/${id}`);
  revalidatePath(`/claims/${id}/vehicles`);
  revalidatePath(`/claims/${id}/work/insurer`);
  revalidatePath(`/claims/${id}`, "layout");
  revalidatePath("/");
  return { ok: true };
}

export async function actionReserveVehicle(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId") || "");
  const returnTo = String(formData.get("returnTo") || "");
  const fleetVehicleId = String(formData.get("fleetVehicleId") || "");
  const versionName = `fleetVersion_${fleetVehicleId}`;
  try {
    createReservation({
      fleetVehicleId,
      claimId: claimId || undefined,
      startAt: new Date(String(formData.get("startAt"))).toISOString(),
      endAt: new Date(String(formData.get("endAt"))).toISOString(),
      kind: String(formData.get("kind") || "hire"),
      createdBy: staff.id,
      expectedVersion: formData.has(versionName) ? String(formData.get(versionName) ?? "") : undefined,
    });
  } catch (error) {
    redirectClash(returnTo || "/hire", error);
    const message = error instanceof Error ? error.message : "Reservation failed.";
    if (returnTo) redirect(`${returnTo}${errorQuery(message)}`);
    return { error: message };
  }
  revalidatePath("/hire");
  if (claimId) {
    revalidatePath(`/claims/${claimId}`);
    revalidatePath(`/claims/${claimId}/work/hire-vehicle`);
    revalidatePath(`/claims/${claimId}/work/reserve`);
  }
  if (returnTo) redirect(`${returnTo}?saved=1`);
  return { ok: true };
}

export async function actionSaveClaimScreen(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  const screenKey = String(formData.get("screenKey"));
  const back = screenReturnPath(claimId, screenKey);
  try {
    saveScreenData(
      claimId,
      screenKey,
      valuesFromForm(formData, screenKey),
      staff.id,
      formVersion(formData),
      formLoaded(formData),
      {
        circumstancesVersion: postedVersion(formData, "circumstancesVersion"),
        ownInsurerVersion: postedVersion(formData, "ownInsurerVersion"),
        clientPersonVersion: postedVersion(formData, "clientPersonVersion"),
        clientGtaVersion: postedVersion(formData, "clientGtaVersion"),
        tpVehicleVersion: postedVersion(formData, "tpVehicleVersion"),
        storageStartVersion: postedVersion(formData, "storageStartVersion"),
        storageEndVersion: postedVersion(formData, "storageEndVersion"),
        recoveryAtVersion: postedVersion(formData, "recoveryAtVersion"),
      },
    );
    if (screenKey === "recovery") syncRecoveryClaimed(claimId);
    if (screenKey === "storage") syncStorageClaimed(claimId);
  } catch (error) {
    if (error instanceof VersionConflictError) redirect(pathWithClash(back, error));
    const message = error instanceof Error ? error.message : "Could not save this screen.";
    if (error instanceof FieldValidationError) redirect(`${back}${problemsQuery(error.problems)}`);
    redirect(`${back}${errorQuery(message)}`);
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/${screenKey}`);
  revalidatePath(`/claims/${claimId}/heads/${screenKey}`);
  redirect(`${screenReturnPath(claimId, screenKey)}?saved=1`);
}

function screenReturnPath(claimId: string, screenKey: string) {
  if (screenKey === "recovery" || screenKey === "storage") return `/claims/${claimId}/heads/${screenKey}`;
  return `/claims/${claimId}/work/${screenKey}`;
}

export async function actionRequestScenePhotosWhatsApp(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  const screenKey = String(formData.get("screenKey") || "accident");
  const values = valuesFromForm(formData, screenKey);
  try {
    saveScreenData(claimId, screenKey, values, staff.id, formVersion(formData), formLoaded(formData));
    if (values.photosAtScene !== "yes") {
      throw new Error("Record that photographs were taken at the scene before asking for them by WhatsApp.");
    }
    await requestScenePhotosWhatsApp(claimId, staff.id);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      redirect(pathWithClash(`/claims/${claimId}/work/${screenKey}`, error));
    }
    const message = error instanceof Error ? error.message : "Could not request the scene photographs.";
    redirect(`/claims/${claimId}/work/${screenKey}${errorQuery(message)}`);
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/${screenKey}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
  redirect(`/claims/${claimId}/work/${screenKey}?saved=1&whatsapp=1`);
}

export async function actionLookupPostcode(postcode: string) {
  await requireStaff();
  const result = await postcodeLookup.search(postcode);
  return {
    simulated: postcodeLookup.simulated,
    licensedPaf: postcodeLookup.licensedPaf,
    provider: postcodeLookup.name,
    ...result,
  };
}

export async function actionLookupVehicle(registration: string) {
  await requireStaff();
  try {
    const result = await vehicleLookup.lookup(registration);
    return { simulated: vehicleLookup.simulated, provider: vehicleLookup.name, result };
  } catch {
    return {
      simulated: true,
      provider: vehicleLookup.name,
      result: {
        registration: (registration || "").toUpperCase().trim(),
        incomplete: true,
        warnings: [VEHICLE_MANUAL_HINT],
        source: "manual",
      },
    };
  }
}

export async function actionLookupCompliance(registration: string) {
  await requireStaff();
  const result = await complianceLookup.check(registration);
  return { simulated: complianceLookup.simulated, provider: complianceLookup.name, result };
}

export async function actionRecordEvent(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const eventType = String(formData.get("eventType") || "other");
  guardGenericHistoryRepairStep(claimId, eventType);
  let refused = "";
  try {
    guardStorageRecoveryClaim(claimId, eventType);
  } catch (error) {
    refused = error instanceof Error ? error.message : "This step was not saved.";
  }
  if (refused) redirect(`/claims/${claimId}/history?${new URLSearchParams({ stepError: refused }).toString()}`);
  recordClaimEvent({
    claimId,
    eventType,
    occurredAt: String(formData.get("occurredAt") || ""),
    details: String(formData.get("details") || "").trim() || undefined,
    actorId: String(formData.get("actorId") || "staff-sian"),
    channel: String(formData.get("channel") || "system"),
    source: "staff",
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/");
}

export async function actionGenerateDocument(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  const templateKey = String(formData.get("templateKey") || "");
  if (!isDocumentTemplateKey(templateKey)) {
    redirect(`/claims/${claimId}${errorQuery("Unknown document template.")}`);
  }
  const requestedReturn = String(formData.get("returnTo") || "");
  const safeReturn = requestedReturn.startsWith(`/claims/${claimId}`)
    ? requestedReturn.split("?")[0]
    : `/claims/${claimId}/work/comms`;
  let documentId = "";
  try {
    const result = generateClaimDocument({
      claimId,
      templateKey,
      actorId: staff.id,
      letterDate: String(formData.get("letterDate") || "") || undefined,
      recordOnFile: generationMarksStep(templateKey) && formData.get("holdBack") !== "yes",
      markSent: true,
      includeGtaStatement: formData.get("gtaStatement") === "yes",
    });
    documentId = result.documentId;
  } catch (error) {
    redirect(`${safeReturn}${errorQuery(error instanceof Error ? error.message : "The document was not produced.")}`);
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/documents");
  redirect(`/documents/${documentId}`);
}

export async function actionPreviewCorrespondence(formData: FormData) {
  await requireStaff();
  const templateKey = String(formData.get("templateKey") || "");
  if (!isDocumentTemplateKey(templateKey)) {
    return { error: "Unknown template.", to: "", subject: "", body: "", html: "", missing: [] as string[], legalSignOffRequired: false };
  }
  let preview;
  try {
    preview = letterPreview(
      String(formData.get("claimId")),
      templateKey,
      String(formData.get("letterDate") || "") || undefined,
      String(formData.get("engineerId") || "") || undefined,
      formData.get("gtaStatement") === "yes",
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The document was not produced.",
      to: "",
      subject: "",
      body: "",
      html: "",
      missing: [] as string[],
      legalSignOffRequired: false,
    };
  }
  const to = "to" in preview && typeof preview.to === "string" ? preview.to : "";
  return {
    to,
    subject: preview.subject,
    body: preview.text,
    html: preview.html,
    missing: preview.missing,
    legalSignOffRequired: preview.legalSignOffRequired,
  };
}

export async function actionSetClaimEngineer(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  const engineerId = String(formData.get("engineerId") || "").trim();
  try {
    withSectionSave({
      scope: "claim-engineer",
      recordKey: claimId,
      expected: formVersion(formData),
      actorId: staff.id,
      submitted: { engineerId },
      labels: { engineerId: "Engineer" },
      fields: { engineerId },
      write: () => setClaimEngineer(claimId, engineerId || null),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the engineer." };
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  return { ok: true as const };
}

export async function actionInstructEngineer(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  const engineerId = String(formData.get("engineerId") || "").trim();
  if (!engineerId) return { error: "Pick an engineer from the list first." };
  try {
    const result = instructEngineer({
      claimId,
      engineerId,
      actorId: staff.id,
      letterDate: String(formData.get("letterDate") || "") || undefined,
    });
    revalidatePath(`/claims/${claimId}`);
    revalidatePath(`/claims/${claimId}/work/comms`);
    revalidatePath("/communications");
    revalidatePath("/documents");
    return { error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not prepare the engineer instruction." };
  }
}

export async function actionMarkEngineerInstructionSent(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  try {
    const result = markEngineerInstructionSent({
      claimId,
      correspondenceId: String(formData.get("correspondenceId") || ""),
      actorId: staff.id,
      occurredAt: String(formData.get("occurredAt") || "") || undefined,
    });
    revalidatePath(`/claims/${claimId}`);
    revalidatePath(`/claims/${claimId}/work/comms`);
    revalidatePath(`/claims/${claimId}/work/history`);
    revalidatePath("/communications");
    return { ok: true as const, error: undefined, ...result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not mark the instruction as sent." };
  }
}

export async function actionSendEmail(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const templateKey = String(formData.get("templateKey") || "");
  const result = await sendClaimEmail({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    to: String(formData.get("to") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    templateKey: isDocumentTemplateKey(templateKey) ? templateKey : undefined,
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
    attachmentIds: formData.getAll("attachmentId").map((value) => String(value)),
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
  return result;
}

export async function actionLogIncomingEmail(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  logIncomingEmail({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    from: String(formData.get("from") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
}

export async function actionSendWhatsApp(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const result = await sendClaimWhatsApp({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    to: String(formData.get("to") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
  return result;
}

export async function actionLogIncomingWhatsApp(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  logIncomingWhatsApp({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    from: String(formData.get("from") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
}

export async function actionRecordCall(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const actorId = String(formData.get("actorId") || "staff-sian");
  const outcome = String(formData.get("outcome") || "connected");
  const party = String(formData.get("party") || "").trim();
  const result = await recordClaimCall({
    claimId,
    actorId,
    direction: String(formData.get("direction") || "outgoing") === "incoming" ? "incoming" : "outgoing",
    number: String(formData.get("number") || "").trim(),
    party,
    outcome,
    notes: String(formData.get("notes") || "").trim() || undefined,
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  if (formData.get("createTask") && outcome !== "connected") {
    addTask({
      claimId,
      handlerId: actorId,
      title: `Call back ${party || "this file"}`,
      details: `Previous outcome: ${outcome}.`,
      type: "call",
      dueAt: isoDaysFromNow(1),
    });
    revalidatePath("/tasks");
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
  return result;
}

function poundsToPence(formData: FormData, name: string) {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return 0;
  return Math.round(Number.parseFloat(raw) * 100);
}

export async function actionSaveHirePack(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  const prior = getHirePack(claimId);
  if (!prior) throw new Error("File not found.");
  try {
    for (const name of ["home_tel", "work_tel", "mobile_tel"]) {
      if (formData.get(`saveAnyway_${name}`) === "yes") continue;
      const phoneMessage = phoneFieldError(name, String(formData.get(name) || ""));
      if (phoneMessage) throw new FieldValidationError(name, phoneMessage);
    }
    withSectionSave({
      scope: "hire-pack",
      recordKey: claimId,
      expected: formVersion(formData),
      actorId: staff.id,
      submitted: {
        title: String(formData.get("title") || ""),
        daily_rate: String(formData.get("daily_rate") || ""),
        group_charged: String(formData.get("group_charged") || ""),
      },
      labels: { title: "Title", daily_rate: "Daily rate", group_charged: "Group charged" },
      fields: {
        title: String(formData.get("title") || ""),
        daily_rate: String(formData.get("daily_rate") || ""),
        group_charged: String(formData.get("group_charged") || ""),
      },
      write: () => {
        const person = clientPersonColumns(claimId);
        const telephone = String(formData.get("mobile_tel") || formData.get("home_tel") || "");
        guardSharedFields({
          scope: SHARED_CLIENT_PERSON,
          recordKey: claimId,
          expected: postedVersion(formData, "clientPersonVersion"),
          actorId: staff.id,
          current: person,
          next: {
            date_of_birth: String(formData.get("date_of_birth") || "") || person.date_of_birth || "",
            licence_number: String(formData.get("licence_number") || "") || person.licence_number || "",
            telephone: telephone || person.telephone || "",
          },
          labels: {
            date_of_birth: "Date of birth",
            licence_number: "Licence number",
            telephone: "Telephone",
            mobile_tel: "Mobile",
          },
          formName: { date_of_birth: "date_of_birth", licence_number: "licence_number", telephone: "mobile_tel" },
          submitted: {
            date_of_birth: String(formData.get("date_of_birth") || ""),
            licence_number: String(formData.get("licence_number") || ""),
            mobile_tel: telephone,
          },
        });
        guardSharedFields({
          scope: SHARED_CLIENT_GTA,
          recordKey: claimId,
          expected: postedVersion(formData, "clientGtaVersion"),
          actorId: staff.id,
          current: { gta_group: clientGtaGroup(claimId) },
          next: { gta_group: normaliseGtaGroup(String(formData.get("client_gta_group") || "")) || "" },
          labels: { gta_group: "GTA group", client_gta_group: "GTA group" },
          formName: { gta_group: "client_gta_group" },
          submitted: { client_gta_group: String(formData.get("client_gta_group") || "") },
        });
        const rating = prepareHireRating({
      claimId,
      clientGroupRaw: String(formData.get("client_gta_group") || ""),
      groupChargedRaw: String(formData.get("group_charged") || ""),
      dailyRateRaw: String(formData.get("daily_rate") || ""),
      overrideReason: String(formData.get("group_override_reason") || ""),
      actorId: String(formData.get("actorId") || ""),
    });
    saveHirePack(claimId, {
    title: String(formData.get("title") || ""),
    home_tel: String(formData.get("home_tel") || ""),
    work_tel: String(formData.get("work_tel") || ""),
    mobile_tel: String(formData.get("mobile_tel") || ""),
    licence_issued_on: formData.has("licence_issued_on")
      ? String(formData.get("licence_issued_on") || "")
      : String(prior.stored.licence_issued_on || ""),
    licence_expires_on: formData.has("licence_expires_on")
      ? String(formData.get("licence_expires_on") || "")
      : String(prior.stored.licence_expires_on || ""),
    additional_name: String(formData.get("additional_name") || ""),
    additional_address: String(formData.get("additional_address") || ""),
    additional_dob: String(formData.get("additional_dob") || ""),
    additional_licence: String(formData.get("additional_licence") || ""),
    additional_licence_issued_on: String(formData.get("additional_licence_issued_on") || ""),
    additional_licence_expires_on: String(formData.get("additional_licence_expires_on") || ""),
    delivery_address: String(formData.get("delivery_address") || ""),
    hire_fuel: String(formData.get("hire_fuel") || ""),
    vehicle_group: String(formData.get("vehicle_group") || ""),
    group_charged: rating.groupCharged,
    date_out: String(formData.get("date_out") || ""),
    date_in: String(formData.get("date_in") || ""),
    // The daily rate is the one stored on the hire at reservation. The pack does not set its own.
    daily_rate_pence: Number(currentHireEpisode(claimId)?.rate_pence_per_day) || Number(prior.stored.daily_rate_pence) || 0,
    daily_rate_manual: 0,
    group_override_reason: String(formData.get("group_override_reason") || ""),
    sat_nav_pence: poundsToPence(formData, "sat_nav"),
    additional_driver_pence: poundsToPence(formData, "additional_driver"),
    hands_free_pence: poundsToPence(formData, "hands_free"),
    cdw_pence: poundsToPence(formData, "cdw"),
    child_seat_pence: poundsToPence(formData, "child_seat"),
    automatic_pence: poundsToPence(formData, "automatic"),
    insurance_daily_pence: poundsToPence(formData, "insurance_daily"),
    estate_pence: poundsToPence(formData, "estate"),
    insurance_pence: poundsToPence(formData, "insurance"),
    tow_bar_pence: poundsToPence(formData, "tow_bar"),
    admin_pence: poundsToPence(formData, "admin"),
    roof_rack_pence: poundsToPence(formData, "roof_rack"),
    delivery_collection_pence: poundsToPence(formData, "delivery_collection"),
    no_replacement_offer: formData.get("no_replacement_offer") ? 1 : 0,
    declined_offer_reason: String(formData.get("declined_offer_reason") || ""),
    understands_personal_liability: formData.get("understands_personal_liability") ? 1 : 0,
    need_reason: String(formData.get("need_reason") || ""),
    own_vehicle_unusable: formData.get("own_vehicle_unusable") ? 1 : 0,
    no_other_vehicle: formData.get("no_other_vehicle") ? 1 : 0,
    means_documents_requested: formData.get("means_documents_requested") ? 1 : 0,
    means_documents_on_file: formData.get("means_documents_on_file") ? 1 : 0,
    cannot_fund_hire: formData.get("cannot_fund_hire") ? 1 : 0,
    no_other_credit: formData.get("no_other_credit") ? 1 : 0,
    means_notes: String(formData.get("means_notes") || ""),
    own_vehicle_mileage: prior.stored.own_vehicle_mileage,
    own_vehicle_fuel: prior.stored.own_vehicle_fuel,
    own_vehicle_tyres: prior.stored.own_vehicle_tyres,
    own_vehicle_damage: prior.stored.own_vehicle_damage,
    delivery_mileage: prior.stored.delivery_mileage,
    delivery_fuel: prior.stored.delivery_fuel,
    delivery_tyres: prior.stored.delivery_tyres,
    delivery_damage: prior.stored.delivery_damage,
    delivery_interior: prior.stored.delivery_interior,
    collection_mileage: prior.stored.collection_mileage,
    collection_fuel: prior.stored.collection_fuel,
    collection_damage: prior.stored.collection_damage,
    storage_daily_pence: poundsToPence(formData, "storage_daily"),
    recovery_pence: poundsToPence(formData, "recovery"),
    driver_delivery_start: String(formData.get("driver_delivery_start") || ""),
    driver_delivery_finish: String(formData.get("driver_delivery_finish") || ""),
    driver_name: String(formData.get("driver_name") || ""),
    date_of_birth: String(formData.get("date_of_birth") || ""),
    licence_number: String(formData.get("licence_number") || ""),
    date_of_birth_confirmed: formData.get("date_of_birth_confirmed") ? "yes" : "",
    additional_dob_confirmed: formData.get("additional_dob_confirmed") ? "yes" : "",
  });
      },
    });
  } catch (error) {
    if (error instanceof VersionConflictError) redirect(pathWithClash(`/claims/${claimId}/hire-pack`, error));
    const message = error instanceof Error ? error.message : "Could not save the hire pack.";
    const field = error instanceof FieldValidationError ? error.field : undefined;
    redirect(`/claims/${claimId}/hire-pack${errorQuery(message, field)}`);
  }
  revalidatePath(`/claims/${claimId}/hire-pack`);
  revalidatePath(`/claims/${claimId}`);
}

export async function actionGenerateHireAgreement(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId"));
  await actionSaveHirePack(formData);
  const result = (() => {
    try {
      return generateHireAgreementDocument(claimId, staff.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate the agreement.";
      redirect(`/claims/${claimId}/hire-pack${errorQuery(message)}`);
    }
  })();
  revalidatePath("/documents");
  revalidatePath(`/claims/${claimId}`);
  redirect(`/documents/${result.documentId}`);
}

export async function actionGenerateHirePack(formData: FormData) {
  await requireStaff();
  await actionSaveHirePack(formData);
  const claimId = String(formData.get("claimId"));
  const result = generateHirePackDocument(claimId, String(formData.get("actorId") || "staff-sian"));
  revalidatePath("/documents");
  redirect(`/documents/${result.documentId}`);
}

export async function actionGenerateStorageRecovery(formData: FormData) {
  await requireStaff();
  await actionSaveHirePack(formData);
  const claimId = String(formData.get("claimId"));
  const result = generateStorageRecoveryDocument(claimId, String(formData.get("actorId") || "staff-sian"));
  revalidatePath("/documents");
  redirect(`/documents/${result.documentId}`);
}
