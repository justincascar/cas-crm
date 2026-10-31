import { damageZoneLabels } from "./file-setup";

/**
 * R52: the bird's-eye car, drawn for CAS (not copied). Front at the top, so the driver side (offside) is on the right
 * and the passenger side (nearside) on the left. viewBox 0 0 320 560. Underside and interior have no shape: they are
 * buttons on screen and words in print.
 */
export const DAMAGE_SHAPES: ReadonlyArray<{ key: string; d: string }> = [
  { key: "front_bumper", d: "M88 22 Q160 4 232 22 L238 52 L82 52 Z" },
  { key: "bonnet", d: "M84 56 L236 56 L232 140 L88 140 Z" },
  { key: "windscreen", d: "M90 144 L230 144 L218 186 L102 186 Z" },
  { key: "roof", d: "M104 190 L216 190 L216 330 L104 330 Z" },
  { key: "rear_window", d: "M104 334 L216 334 L226 372 L94 372 Z" },
  { key: "boot", d: "M90 376 L230 376 L234 470 L86 470 Z" },
  { key: "rear_bumper", d: "M84 474 L236 474 L230 506 Q160 524 90 506 Z" },
  { key: "nearside_front_wing", d: "M48 60 L80 56 L84 140 L48 140 Z" },
  { key: "nearside_front_door", d: "M48 144 L86 144 L100 190 L100 258 L48 258 Z" },
  { key: "nearside_rear_door", d: "M48 262 L100 262 L100 334 L90 372 L48 372 Z" },
  { key: "nearside_rear_quarter", d: "M48 376 L86 376 L82 470 L48 470 Z" },
  { key: "offside_front_wing", d: "M240 56 L272 60 L272 140 L236 140 Z" },
  { key: "offside_front_door", d: "M234 144 L272 144 L272 258 L220 258 L220 190 Z" },
  { key: "offside_rear_door", d: "M220 262 L272 262 L272 372 L230 372 L220 334 Z" },
  { key: "offside_rear_quarter", d: "M234 376 L272 376 L272 470 L238 470 Z" },
  { key: "nearside_front_wheel", d: "M10 74 h34 v62 h-34 Z" },
  { key: "nearside_rear_wheel", d: "M10 392 h34 v62 h-34 Z" },
  { key: "offside_front_wheel", d: "M276 74 h34 v62 h-34 Z" },
  { key: "offside_rear_wheel", d: "M276 392 h34 v62 h-34 Z" },
];

export const CAS_RED = "#DC002B";

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** A small printed copy (HTML) for the engineer instruction: the outline with the chosen zones filled, then the list. */
export function damagePrintHtml(zones: string[]): string {
  const labels = damageZoneLabels(zones);
  const paths = DAMAGE_SHAPES.map(
    (shape) => `<path d="${shape.d}" fill="${zones.includes(shape.key) ? CAS_RED : "#ffffff"}" stroke="#143044" stroke-width="3"/>`,
  ).join("");
  return `<div class="damage-print" style="display:flex;gap:16px;align-items:flex-start">
<svg viewBox="0 0 320 560" width="96" height="168" role="img" aria-label="${escapeText(`Damage marked: ${labels.join(", ") || "none"}`)}"><text x="160" y="16" text-anchor="middle" font-size="16">Front</text>${paths}</svg>
<p>Passenger side is nearside; driver side is offside.<br/>${labels.length ? escapeText(labels.join(", ")) : "No damaged areas marked."}</p>
</div>`;
}
