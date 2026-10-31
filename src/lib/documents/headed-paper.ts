/**
 * Which documents print on CAS's headed paper (R41). Every generated letter, chaser, invoice, pack and chronology does.
 * The supplied Hire Pack and hire agreement pages keep their own layout and wording: only the logo is added, at the top
 * of the first page where there is room.
 */
const SUPPLIED_HIRE_PACK_LAYOUT = new Set(["hire_agreement", "hire_pack"]);

export function headedPaperVariant(templateKey: string): "full" | "logo" {
  return SUPPLIED_HIRE_PACK_LAYOUT.has(templateKey) ? "logo" : "full";
}
