import { getClaimScreen } from "./claim-screens";
import { formatTypedValue } from "./text";

export function displayValue(screenKey: string, name: string, raw: string) {
  const def = getClaimScreen(screenKey);
  const field = def?.sections.flatMap((s) => s.fields).find((f) => f.name === name);
  if (field?.type === "gbp" && raw) {
    const pence = Number.parseInt(raw, 10);
    if (Number.isFinite(pence)) return (pence / 100).toFixed(2);
  }
  return formatTypedValue(name, raw, field?.type);
}
