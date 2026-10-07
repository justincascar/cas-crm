import { formatUkDateTime, nowUtcIso } from "../dates";
import {
  ABILITY_ANSWERS,
  ABILITY_TO_PAY_QUESTION,
  CHECKLIST_STATUSES,
  EMPLOYMENT_STATUSES,
  EVIDENCE_KINDS,
  OFFER_POSITIONS,
  canApproveImpecuniosity,
  canMarkChecklist,
  clientAbilitySentence,
  impecuniosityGenerationBlock,
  impecuniosityWithheldSentence,
  isChecklistStatus,
  type ChecklistStatus,
  type OfferPosition,
} from "../domain/impecuniosity";
import { all, get, newId, run } from "./connection";

function now() {
  return nowUtcIso();
}

type CircumstanceRow = {
  id: string;
  claim_id: string;
  recorded_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  correction_reason: string | null;
  employment_status: string;
  employment_words: string | null;
  income_as_stated: string | null;
  benefits_as_stated: string | null;
  ability_to_pay: string;
  ability_to_pay_words: string | null;
  no_bank_explanation: string | null;
  question_wording: string;
};

type AccountRow = {
  id: string;
  claim_id: string;
  label: string;
  kind: string;
  notes: string | null;
  recorded_at: string;
  recorded_by_name: string | null;
};

type ConcernRow = {
  id: string;
  body: string;
  recorded_at: string;
  recorded_by_name: string | null;
};

type MitigationRow = {
  id: string;
  claim_id: string;
  recorded_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  statement_on: string | null;
  correction_reason: string | null;
  offer_position: string;
  declined_offer_reason: string | null;
  understands_personal_liability: number;
  need_reason: string;
  own_vehicle_unusable: number;
  no_other_vehicle: number;
};

function assertClaim(claimId: string) {
  const claim = get<{ id: string }>(`SELECT id FROM claims WHERE id = ?`, [claimId]);
  if (!claim) throw new Error("File not found.");
}

function employmentOrThrow(value: string): string {
  const status = value.trim();
  if (!EMPLOYMENT_STATUSES.some((item) => item.value === status)) {
    throw new Error("Record the employment status the client gave. Do not leave it blank.");
  }
  return status;
}

function abilityOrThrow(value: string): string {
  const answer = value.trim();
  if (!ABILITY_ANSWERS.some((item) => item.value === answer)) {
    throw new Error("Record the client's own answer to the ability-to-pay question.");
  }
  return answer;
}

function kindOrThrow(value: string): string {
  const kind = value.trim();
  if (!EVIDENCE_KINDS.some((item) => item.value === kind)) {
    throw new Error("Choose bank statements, wage slips, a benefit schedule, household commitments, or other income or support.");
  }
  return kind;
}

export function listFinancialCircumstances(claimId: string): CircumstanceRow[] {
  return all<CircumstanceRow>(
    `SELECT f.*, s.name AS recorded_by_name
     FROM financial_circumstances f
     LEFT JOIN staff s ON s.id = f.recorded_by
     WHERE f.claim_id = ?
     ORDER BY f.recorded_at ASC, f.rowid ASC`,
    [claimId],
  );
}

export function saveFinancialCircumstances(input: {
  claimId: string;
  actorId: string;
  employmentStatus: string;
  employmentWords?: string;
  incomeAsStated?: string;
  benefitsAsStated?: string;
  abilityToPay: string;
  abilityToPayWords?: string;
  noBankExplanation?: string;
  correctionReason?: string;
}) {
  assertClaim(input.claimId);
  const previous = listFinancialCircumstances(input.claimId);
  const reason = (input.correctionReason || "").trim();
  if (previous.length > 0 && !reason) {
    throw new Error("A change is a new dated entry. Say why this replaces the earlier record. The earlier record is kept.");
  }
  const id = newId("fin");
  run(
    `INSERT INTO financial_circumstances(
       id, claim_id, recorded_at, recorded_by, correction_reason, employment_status, employment_words,
       income_as_stated, benefits_as_stated, ability_to_pay, ability_to_pay_words, no_bank_explanation, question_wording
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.claimId,
      now(),
      input.actorId,
      previous.length > 0 ? reason : null,
      employmentOrThrow(input.employmentStatus),
      (input.employmentWords || "").trim(),
      (input.incomeAsStated || "").trim(),
      (input.benefitsAsStated || "").trim(),
      abilityOrThrow(input.abilityToPay),
      (input.abilityToPayWords || "").trim(),
      (input.noBankExplanation || "").trim(),
      ABILITY_TO_PAY_QUESTION,
    ],
  );
  return id;
}

export function listImpecuniosityAccounts(claimId: string): AccountRow[] {
  return all<AccountRow>(
    `SELECT a.id, a.claim_id, a.label, a.kind, a.notes, a.recorded_at, s.name AS recorded_by_name
     FROM impecuniosity_accounts a
     LEFT JOIN staff s ON s.id = a.recorded_by
     WHERE a.claim_id = ?
     ORDER BY a.recorded_at ASC, a.rowid ASC`,
    [claimId],
  );
}

export function addImpecuniosityAccount(input: { claimId: string; actorId: string; label: string; kind: string; notes?: string }) {
  assertClaim(input.claimId);
  const label = input.label.trim();
  if (!label) throw new Error("Name each account, set of papers, or explanation. Each one is listed on its own.");
  const id = newId("acc");
  run(
    `INSERT INTO impecuniosity_accounts(id, claim_id, label, kind, notes, recorded_at, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.claimId, label, kindOrThrow(input.kind), (input.notes || "").trim(), now(), input.actorId],
  );
  return id;
}

export function checklistStatus(claimId: string): ChecklistStatus {
  const row = get<{ status: string }>(
    `SELECT status FROM impecuniosity_checklist_events WHERE claim_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
    [claimId],
  );
  return row && isChecklistStatus(row.status) ? row.status : "not_started";
}

export function setChecklistStatus(input: { claimId: string; actorId: string; actorRole: string; status: string }) {
  assertClaim(input.claimId);
  if (!canMarkChecklist(input.actorRole)) {
    throw new Error("Only a handler can change the evidence checklist.");
  }
  if (!isChecklistStatus(input.status) || !(CHECKLIST_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error("Choose Not started, Requested, Partial, or Complete.");
  }
  if (input.status === "complete" && !canMarkChecklist(input.actorRole)) {
    throw new Error("Only a handler can mark the checklist Complete.");
  }
  run(
    `INSERT INTO impecuniosity_checklist_events(id, claim_id, status, recorded_at, recorded_by) VALUES (?, ?, ?, ?, ?)`,
    [newId("chk"), input.claimId, input.status, now(), input.actorId],
  );
}

export function listDisclosureConcerns(claimId: string): ConcernRow[] {
  return all<ConcernRow>(
    `SELECT c.id, c.body, c.recorded_at, s.name AS recorded_by_name
     FROM impecuniosity_concerns c
     LEFT JOIN staff s ON s.id = c.recorded_by
     WHERE c.claim_id = ?
     ORDER BY c.recorded_at ASC, c.rowid ASC`,
    [claimId],
  );
}

export function addDisclosureConcern(input: { claimId: string; actorId: string; actorRole: string; body: string }) {
  assertClaim(input.claimId);
  if (!canMarkChecklist(input.actorRole)) throw new Error("Only a handler can record a disclosure concern.");
  const body = input.body.trim();
  if (!body) throw new Error("Write the concern in your own words. The system does not draft one.");
  const id = newId("concern");
  run(
    `INSERT INTO impecuniosity_concerns(id, claim_id, body, recorded_at, recorded_by) VALUES (?, ?, ?, ?, ?)`,
    [id, input.claimId, body, now(), input.actorId],
  );
  return id;
}

export function impecuniosityApproved(claimId: string): boolean {
  const row = get<{ approved: number }>(
    `SELECT approved FROM impecuniosity_approvals WHERE claim_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
    [claimId],
  );
  return Number(row?.approved) === 1;
}

export function setImpecuniosityApproval(input: { claimId: string; actorId: string; actorRole: string; approved: boolean }) {
  assertClaim(input.claimId);
  if (!canApproveImpecuniosity(input.actorRole)) {
    throw new Error("Only an authorised user can approve relying on impecuniosity. In this CRM that is an administrator.");
  }
  run(
    `INSERT INTO impecuniosity_approvals(id, claim_id, approved, recorded_at, recorded_by) VALUES (?, ?, ?, ?, ?)`,
    [newId("appr"), input.claimId, input.approved ? 1 : 0, now(), input.actorId],
  );
}

export function listMitigationStatements(claimId: string): MitigationRow[] {
  return all<MitigationRow>(
    `SELECT m.*, s.name AS recorded_by_name
     FROM mitigation_statements m
     LEFT JOIN staff s ON s.id = m.recorded_by
     WHERE m.claim_id = ?
     ORDER BY m.recorded_at ASC, m.rowid ASC`,
    [claimId],
  );
}

export function saveMitigationStatement(input: {
  claimId: string;
  actorId: string;
  statementOn?: string;
  correctionReason?: string;
  offerPosition: string;
  declinedOfferReason?: string;
  understandsPersonalLiability: boolean;
  needReason: string;
  ownVehicleUnusable: boolean;
  noOtherVehicle: boolean;
}) {
  assertClaim(input.claimId);
  const previous = listMitigationStatements(input.claimId);
  const reason = (input.correctionReason || "").trim();
  if (previous.length > 0 && !reason) {
    throw new Error("A correction is a new dated entry. Say what was wrong with the earlier statement. The earlier statement is kept.");
  }
  const offer = input.offerPosition.trim();
  if (!(OFFER_POSITIONS as readonly string[]).includes(offer)) {
    throw new Error("Record whether the client had an offer of a replacement vehicle.");
  }
  const declined = (input.declinedOfferReason || "").trim();
  if (offer === "declined" && !declined) {
    throw new Error("The client said an offer was not accepted. Record why, in their words.");
  }
  const id = newId("mit");
  run(
    `INSERT INTO mitigation_statements(
       id, claim_id, recorded_at, recorded_by, statement_on, correction_reason, offer_position,
       declined_offer_reason, understands_personal_liability, need_reason, own_vehicle_unusable, no_other_vehicle
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.claimId,
      now(),
      input.actorId,
      (input.statementOn || "").trim() || null,
      previous.length > 0 ? reason : null,
      offer as OfferPosition,
      declined,
      input.understandsPersonalLiability ? 1 : 0,
      input.needReason.trim(),
      input.ownVehicleUnusable ? 1 : 0,
      input.noOtherVehicle ? 1 : 0,
    ],
  );
  return id;
}

export type ImpecuniosityGate = {
  status: ChecklistStatus;
  approved: boolean;
  canRely: boolean;
  generationBlock: string | null;
  withheldSentence: string;
  clientAnswer: string | null;
};

export function impecuniosityGate(claimId: string): ImpecuniosityGate {
  const status = checklistStatus(claimId);
  const approved = impecuniosityApproved(claimId);
  const latest = listFinancialCircumstances(claimId).at(-1);
  const clientAnswer = latest
    ? clientAbilitySentence({
        question: latest.question_wording,
        answer: latest.ability_to_pay,
        words: latest.ability_to_pay_words || "",
        recordedLabel: formatUkDateTime(latest.recorded_at),
      })
    : null;
  return {
    status,
    approved,
    canRely: status === "complete" && approved,
    generationBlock: impecuniosityGenerationBlock(status, approved),
    withheldSentence: impecuniosityWithheldSentence(status, approved),
    clientAnswer,
  };
}

export function latestMitigationForPack(claimId: string): MitigationRow | null {
  return listMitigationStatements(claimId).at(-1) || null;
}
