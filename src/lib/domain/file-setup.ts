/**
 * R50: the file set-up (liability status, jurisdiction, roadworthiness, handler) comes last on the new-claim form,
 * after the facts. Each item is pre-filled as a suggestion that staff confirm or change. Liability is never suggested.
 * Any of them may be "Not yet known"; the file then shows "File set-up incomplete" as its next step, and what depends
 * on them does not start.
 */

export const JURISDICTION_NOT_KNOWN = "not_known";

/**
 * R52: the zones on the bird's-eye drawing. Staff say driver and passenger side; insurers and engineers say offside
 * and nearside, so both are shown. Stored as these keys, so they can be searched and reported on.
 */
const SIDE = { offside: "Driver side", nearside: "Passenger side" } as const;
const SIDE_PARTS = [
  ["front_wing", "front wing"],
  ["front_door", "front door"],
  ["rear_door", "rear door"],
  ["rear_quarter", "rear quarter"],
  ["front_wheel", "front wheel"],
  ["rear_wheel", "rear wheel"],
] as const;

export const DAMAGE_ZONES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "front_bumper", label: "Front bumper" },
  { key: "bonnet", label: "Bonnet" },
  { key: "windscreen", label: "Windscreen" },
  { key: "roof", label: "Roof" },
  { key: "rear_window", label: "Rear window" },
  { key: "boot", label: "Boot or tailgate" },
  { key: "rear_bumper", label: "Rear bumper" },
  ...(["offside", "nearside"] as const).flatMap((side) =>
    SIDE_PARTS.map(([part, words]) => ({ key: `${side}_${part}`, label: `${SIDE[side]} ${words}` })),
  ),
  { key: "underside", label: "Underside" },
  { key: "interior", label: "Interior" },
];

const ZONE_KEYS = new Set(DAMAGE_ZONES.map((zone) => zone.key));

export function parseDamageZones(raw: string | null | undefined): string[] {
  const picked = new Set(String(raw || "").split(",").map((item) => item.trim()).filter((item) => ZONE_KEYS.has(item)));
  return DAMAGE_ZONES.map((zone) => zone.key).filter((key) => picked.has(key));
}

export function damageZoneLabels(keys: string[]): string[] {
  return keys.map((key) => DAMAGE_ZONES.find((zone) => zone.key === key)?.label || key);
}

/** R52: "Is it safe to drive?" Each is Yes, No or Not known. Any Yes suggests Unroadworthy, with these reasons. */
export const SAFE_TO_DRIVE_QUESTIONS = [
  { key: "rqLights", label: "Lights smashed or not working", reason: "lights smashed" },
  { key: "rqLoose", label: "Loose or hanging parts", reason: "loose or hanging parts" },
  { key: "rqSharp", label: "Sharp or jagged edges", reason: "sharp edges" },
  { key: "rqGlass", label: "Glass broken or cracked", reason: "glass broken" },
  { key: "rqWheels", label: "Tyre, wheel or suspension damage", reason: "tyre, wheel or suspension damage" },
  { key: "rqWarning", label: "Warning lights on the dashboard", reason: "warning lights on" },
  { key: "rqLeaking", label: "Leaking fluids", reason: "fluid leak" },
  { key: "rqAirbags", label: "Airbags gone off", reason: "airbags gone off" },
  { key: "rqShut", label: "Doors, bonnet or boot won't shut", reason: "doors, bonnet or boot won't shut" },
  { key: "rqSteering", label: "Steering pulls or it drives badly", reason: "steering pulls or drives badly" },
] as const;

export type SafeToDriveKey = (typeof SAFE_TO_DRIVE_QUESTIONS)[number]["key"];
export type SafeToDriveAnswers = Partial<Record<SafeToDriveKey, string>>;

export const SAFE_TO_DRIVE_CHOICES = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_known", label: "Not known" },
] as const;

export function safeToDriveReasons(answers: SafeToDriveAnswers): string[] {
  return SAFE_TO_DRIVE_QUESTIONS.filter((q) => answers[q.key] === "yes").map((q) => q.reason);
}

/**
 * A suggestion, never a certificate. Any Yes suggests Unroadworthy with the reasons. Roadworthy is suggested only
 * when every question is answered No. Otherwise the suggestion is Not yet known.
 */
export function suggestRoadworthiness(answers: SafeToDriveAnswers): { value: "" | "roadworthy" | "unroadworthy"; text: string } {
  const reasons = safeToDriveReasons(answers);
  if (reasons.length) return { value: "unroadworthy", text: `Unroadworthy – ${reasons.join(", ")}` };
  if (SAFE_TO_DRIVE_QUESTIONS.every((q) => answers[q.key] === "no")) {
    return { value: "roadworthy", text: "Roadworthy – every safe-to-drive answer is No" };
  }
  return { value: "", text: "Not yet known – not every safe-to-drive question is answered" };
}

const POSTCODE = /\b([A-Z]{1,2})(\d[A-Z\d]?)\s*\d[A-Z]{2}\b/i;
const SCOTLAND_AREAS = new Set(["AB", "DD", "DG", "EH", "FK", "G", "HS", "IV", "KA", "KW", "KY", "ML", "PA", "PH", "TD", "ZE"]);
/** Districts that straddle the Scotland–England border, so the postcode alone does not settle it. */
const BORDER_DISTRICTS = new Set(["TD9", "TD12", "TD15", "DG16"]);
const NOT_UK_COURTS = new Set(["IM", "JE", "GY"]);

export function findPostcode(text: string | null | undefined): { area: string; district: string; postcode: string } | null {
  const match = String(text || "").toUpperCase().match(POSTCODE);
  if (!match) return null;
  return { area: match[1]!, district: `${match[1]}${match[2]}`, postcode: match[0].replace(/\s+/g, " ") };
}

/**
 * Suggested from the accident location's postcode, or failing that the client's. England & Wales only when the
 * postcode is in England or Wales; otherwise Scotland, Northern Ireland, or Not yet known.
 */
export function suggestJurisdiction(accidentLocation: string, clientPostcode: string): { value: string; text: string } {
  const fromAccident = findPostcode(accidentLocation);
  const found = fromAccident || findPostcode(clientPostcode);
  if (!found) return { value: JURISDICTION_NOT_KNOWN, text: "Not yet known – no postcode for the accident location or the client" };
  const where = fromAccident ? `accident location postcode ${found.postcode}` : `client's postcode ${found.postcode}`;
  if (BORDER_DISTRICTS.has(found.district) || NOT_UK_COURTS.has(found.area)) {
    return { value: JURISDICTION_NOT_KNOWN, text: `Not yet known – the ${where} does not settle it` };
  }
  if (found.area === "BT") return { value: "northern_ireland", text: `Northern Ireland – from the ${where}` };
  if (SCOTLAND_AREAS.has(found.area)) return { value: "scotland", text: `Scotland – from the ${where}` };
  return { value: "england_wales", text: `England & Wales – from the ${where}` };
}

/** One line of the circumstances, shown above the fault choice. */
export function circumstancesSummary(text: string | null | undefined, max = 160): string {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** What is still to be decided in the file set-up. */
export function fileSetupGaps(input: { claimType: string | null | undefined; jurisdiction: string | null | undefined; roadworthiness: string | null | undefined }): string[] {
  const gaps: string[] = [];
  if (!String(input.claimType || "").trim()) gaps.push("liability status");
  if (String(input.jurisdiction || "") === JURISDICTION_NOT_KNOWN) gaps.push("jurisdiction");
  if (!String(input.roadworthiness || "").trim() || input.roadworthiness === "unknown") gaps.push("roadworthiness");
  return gaps;
}

export function fileSetupIncompleteMessage(gaps: string[], what: string): string {
  return `File set-up incomplete: ${gaps.join(", ")} not yet known. ${what} until the file set-up is decided on the Details tab (File set-up).`;
}
