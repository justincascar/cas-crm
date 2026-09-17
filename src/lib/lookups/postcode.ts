import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { formatPostcode, isCompleteUkPostcode } from "../text";

export type AddressSuggestion = {
  line1: string;
  line2?: string;
  town: string;
  postcode: string;
};

export type PostcodeSearchResult = {
  results: AddressSuggestion[];
  formattedPostcode?: string;
  town?: string;
  error?: string;
  warning?: string;
};

export interface PostcodeLookup {
  name: string;
  simulated: boolean;
  licensedPaf: boolean;
  search(postcode: string): Promise<PostcodeSearchResult>;
}

type IdealAddress = {
  line_1?: string;
  line_2?: string;
  line_3?: string;
  post_town?: string;
  postcode?: string;
};

type IdealPostcodesBody = {
  result?: IdealAddress[] | null;
  message?: string;
  code?: number;
};

export function addressesFromIdealPostcodes(result: IdealAddress[]): AddressSuggestion[] {
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const row of result) {
    const line1 = [row.line_1, row.line_2, row.line_3].map((part) => (part || "").trim()).filter(Boolean).join(", ");
    const town = (row.post_town || "").trim();
    const postcode = formatPostcode(row.postcode || "");
    if (!line1) continue;
    const key = `${line1}|${town}|${postcode}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ line1, town, postcode, line2: row.line_2 });
  }
  out.sort((a, b) => a.line1.localeCompare(b.line1, "en-GB", { numeric: true }));
  return out;
}

const USER_AGENT = "CAS-CRM/1.0 (Complete Accident Solutions local prototype)";
const POSTCODES_IO = "https://api.postcodes.io/postcodes/";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

type PostcodesIoBody = {
  status?: number;
  result?: {
    postcode?: string;
    latitude?: number;
    longitude?: number;
    admin_district?: string | null;
    parish?: string | null;
    admin_ward?: string | null;
    nuts?: string | null;
  } | null;
};

type OverpassElement = {
  tags?: Record<string, string>;
};

type OverpassBody = {
  elements?: OverpassElement[];
};

type NominatimHit = {
  display_name?: string;
  address?: {
    house_number?: string;
    road?: string;
    village?: string;
    hamlet?: string;
    town?: string;
    city?: string;
    suburb?: string;
    postcode?: string;
  };
};

export function postcodesIoTown(result: NonNullable<PostcodesIoBody["result"]>): string {
  return result.admin_district || result.parish || result.admin_ward || result.nuts || "";
}

export function townFromNominatim(hit?: NominatimHit | null): string {
  const a = hit?.address;
  if (!a) return "";
  return a.village || a.hamlet || a.town || a.city || a.suburb || "";
}

function compactPostcode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function addressesFromOverpass(
  elements: OverpassElement[],
  formattedPostcode: string,
  fallbackTown: string,
): AddressSuggestion[] {
  const target = compactPostcode(formattedPostcode);
  const seen = new Set<string>();
  const taggedHouses: AddressSuggestion[] = [];
  const nearbyHouses: AddressSuggestion[] = [];
  const streets: AddressSuggestion[] = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const tagged = compactPostcode(tags["addr:postcode"] || "");
    if (tagged && tagged !== target) continue;
    const town = tags["addr:city"] || tags["addr:town"] || fallbackTown;
    const postcode = formatPostcode(tags["addr:postcode"] || formattedPostcode);

    const houseLine = [tags["addr:housename"], tags["addr:housenumber"], tags["addr:street"] || tags["addr:place"]]
      .map((part) => (part || "").trim())
      .filter(Boolean)
      .join(" ");
    if (houseLine && (tags["addr:housenumber"] || tags["addr:housename"])) {
      const key = `${houseLine}|${town}|${postcode}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        const item = { line1: houseLine, town, postcode };
        if (tagged === target) taggedHouses.push(item);
        else nearbyHouses.push(item);
      }
      continue;
    }

    const street = (tags["addr:street"] || tags.name || "").trim();
    const highway = (tags.highway || "").trim();
    if (street && highway && highway !== "bus_stop" && highway !== "platform") {
      const key = `street:${street}|${town}|${postcode}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        streets.push({ line1: street, town, postcode });
      }
    }
  }

  taggedHouses.sort((a, b) => a.line1.localeCompare(b.line1, "en-GB", { numeric: true }));
  nearbyHouses.sort((a, b) => a.line1.localeCompare(b.line1, "en-GB", { numeric: true }));
  const houseStreets = new Set(taggedHouses.map((h) => h.line1.replace(/^\S+\s+/, "").toLowerCase()));
  const sameStreetNearby = nearbyHouses.filter((h) => houseStreets.has(h.line1.replace(/^\S+\s+/, "").toLowerCase()));
  const houses = taggedHouses.length > 0 ? [...taggedHouses, ...sameStreetNearby] : nearbyHouses;
  houses.sort((a, b) => a.line1.localeCompare(b.line1, "en-GB", { numeric: true }));
  const extraStreets = streets.filter((s) => !houseStreets.has(s.line1.toLowerCase()));
  extraStreets.sort((a, b) => a.line1.localeCompare(b.line1, "en-GB"));
  if (houses.length > 0) return houses.length >= 3 ? houses : [...houses, ...extraStreets];
  return extraStreets;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
  return res.json();
}

async function lookupPostcodesIo(postcode: string): Promise<NonNullable<PostcodesIoBody["result"]> | null> {
  const compact = postcode.replace(/\s+/g, "");
  const body = (await fetchJson(`${POSTCODES_IO}${encodeURIComponent(compact)}`, {}, 4000)) as PostcodesIoBody;
  return body.result || null;
}

async function lookupNominatim(postcode: string): Promise<NominatimHit | null> {
  const url =
    `${NOMINATIM}?postalcode=${encodeURIComponent(postcode)}` +
    "&countrycodes=gb&format=jsonv2&addressdetails=1&limit=1";
  const hits = (await fetchJson(url, {}, 4000)) as NominatimHit[];
  return hits[0] || null;
}

async function lookupOverpass(formatted: string, lat?: number, lon?: number): Promise<OverpassElement[]> {
  const spaced = formatted;
  const compact = formatted.replace(/\s+/g, "");
  const around =
    lat != null && lon != null
      ? `nwr["addr:housenumber"](around:80,${lat},${lon});way["highway"~"^(residential|tertiary|unclassified|living_street)$"]["name"](around:80,${lat},${lon});`
      : "";
  const query = `[out:json][timeout:6];(nwr["addr:postcode"="${spaced}"];nwr["addr:postcode"="${compact}"];${around});out tags 250;`;
  const body = "data=" + encodeURIComponent(query);
  const attempts = OVERPASS_URLS.map((url) => overpassPost(url, body));
  try {
    return await Promise.race([
      firstElements(attempts),
      sleep(3500).then(() => [] as OverpassElement[]),
    ]);
  } catch {
    return [];
  }
}

async function firstElements(attempts: Promise<OverpassBody>[]): Promise<OverpassElement[]> {
  return await new Promise((resolve, reject) => {
    let remaining = attempts.length;
    for (const attempt of attempts) {
      attempt
        .then((json) => resolve(json.elements || []))
        .catch(() => {
          remaining -= 1;
          if (remaining === 0) reject(new Error("All Overpass mirrors failed"));
        });
    }
  });
}

function overpassPost(url: string, body: string): Promise<OverpassBody> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpsRequest(
      {
        hostname: target.hostname,
        path: target.pathname,
        method: "POST",
        family: 4,
        lookup: (hostname, options, callback) => dnsLookup(hostname, { ...options, family: 4 }, callback),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 3000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Lookup failed (${res.statusCode || 0})`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as OverpassBody);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Lookup timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Free UK lookup: postcodes.io / Nominatim for the postcode and town.
 * OpenStreetMap house lists are used when they come back quickly (not Royal Mail PAF).
 */
export class IdealPostcodesLookup implements PostcodeLookup {
  name = "Ideal Postcodes (Royal Mail PAF)";
  simulated = false;
  licensedPaf = true;

  constructor(private readonly apiKey: string) {}

  async search(postcode: string): Promise<PostcodeSearchResult> {
    const typed = formatPostcode(postcode);
    if (!isCompleteUkPostcode(typed)) {
      return { results: [], error: "Enter a full UK postcode." };
    }
    const compact = typed.replace(/\s+/g, "");
    try {
      const url =
        `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(compact)}` +
        `?api_key=${encodeURIComponent(this.apiKey)}`;
      const body = (await fetchJson(url, {}, 8000)) as IdealPostcodesBody;
      const results = addressesFromIdealPostcodes(body.result || []);
      if (results.length === 0) {
        return {
          results: [],
          formattedPostcode: typed,
          error: "That postcode was not found. Check the letters and numbers, or type the address.",
        };
      }
      return {
        results,
        formattedPostcode: results[0]?.postcode || typed,
        town: results[0]?.town,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("(401)") || message.includes("(403)")) {
        return { results: [], error: "The licensed postcode key was refused. Type the address, or check the Ideal Postcodes key." };
      }
      if (message.includes("(404)")) {
        return { results: [], formattedPostcode: typed, error: "That postcode was not found. Check the letters and numbers, or type the address." };
      }
      return { results: [], error: "The licensed postcode service could not be reached. Type the address." };
    }
  }
}

export class FreeUkPostcodeLookup implements PostcodeLookup {
  name = "postcodes.io, Nominatim and OpenStreetMap";
  simulated = false;
  licensedPaf = false;

  async search(postcode: string): Promise<PostcodeSearchResult> {
    const typed = formatPostcode(postcode);
    if (!isCompleteUkPostcode(typed)) {
      return { results: [], error: "Enter a full UK postcode." };
    }
    try {
      const [pc, nominatim] = await Promise.all([
        lookupPostcodesIo(typed),
        lookupNominatim(typed).catch(() => null),
      ]);
      if (!pc?.postcode) {
        return { results: [], error: "That postcode was not found. Check the letters and numbers, or type the address." };
      }
      const formattedPostcode = formatPostcode(pc.postcode);
      const town = townFromNominatim(nominatim) || postcodesIoTown(pc);
      let results: AddressSuggestion[] = [];
      try {
        results = addressesFromOverpass(
          await lookupOverpass(formattedPostcode, pc.latitude, pc.longitude),
          formattedPostcode,
          town,
        );
      } catch {
        results = [];
      }
      if (results.length === 0) {
        return {
          results: [],
          formattedPostcode,
          town,
          warning: "Postcode found. Type the house number and street — a house list is not available for this postcode.",
        };
      }
      return { results, formattedPostcode, town };
    } catch {
      return {
        results: [],
        error: "The free postcode service could not be reached. Type the address.",
      };
    }
  }
}

export function createPostcodeLookup(): PostcodeLookup {
  const key = (process.env.IDEAL_POSTCODES_API_KEY || "").trim();
  if (key) return new IdealPostcodesLookup(key);
  return new FreeUkPostcodeLookup();
}

export const postcodeLookup: PostcodeLookup = createPostcodeLookup();
