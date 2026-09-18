export type KnownInsurer = {
  name: string;
  address: string;
  postcode: string;
  telephone: string;
  email: string;
  handlerName?: string;
  handlerEmail?: string;
  handlerTel?: string;
};

const UNUSABLE = new Set(["", "unknown", "n/a", "na", "none", "-"]);

export function insurerNameKey(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isUsableInsurerName(name: string | null | undefined): boolean {
  const key = insurerNameKey(name || "");
  return Boolean(key) && !UNUSABLE.has(key);
}

export function blankInsurerField(value: string | null | undefined): string {
  const t = (value || "").trim();
  if (!t || UNUSABLE.has(insurerNameKey(t))) return "";
  return t;
}

export function matchKnownInsurers(insurers: KnownInsurer[], query: string): KnownInsurer[] {
  const q = insurerNameKey(query);
  if (!q) return [];
  const usable = insurers.filter((row) => isUsableInsurerName(row.name));
  const starts = usable.filter((row) => insurerNameKey(row.name).startsWith(q));
  const contains = usable.filter((row) => {
    const key = insurerNameKey(row.name);
    return key.includes(q) && !key.startsWith(q);
  });
  return [...starts, ...contains].slice(0, 8);
}

export function exactKnownInsurer(insurers: KnownInsurer[], query: string): KnownInsurer | null {
  const q = insurerNameKey(query);
  if (!q) return null;
  return insurers.find((row) => insurerNameKey(row.name) === q) || null;
}

export function mergeInsurerDetails(
  current: KnownInsurer,
  picked: KnownInsurer,
  mode: "replace" | "empty-only",
): KnownInsurer {
  const take = (from: string, existing: string) => {
    if (!from) return existing;
    if (mode === "replace") return from;
    return existing || from;
  };
  return {
    name: picked.name || current.name,
    address: take(picked.address, current.address),
    postcode: take(picked.postcode, current.postcode),
    telephone: take(picked.telephone, current.telephone),
    email: take(picked.email, current.email),
    handlerName: take(picked.handlerName || "", current.handlerName || ""),
    handlerEmail: take(picked.handlerEmail || "", current.handlerEmail || ""),
    handlerTel: take(picked.handlerTel || "", current.handlerTel || ""),
  };
}
