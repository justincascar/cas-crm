import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addressesFromIdealPostcodes, addressesFromOverpass, postcodesIoTown, townFromNominatim } from "../src/lib/lookups/postcode.ts";
import { isCompleteUkPostcode } from "../src/lib/text.ts";

describe("free postcode lookup mapping", () => {
  it("recognises a complete UK postcode", () => {
    assert.equal(isCompleteUkPostcode("CF24 2DA"), true);
    assert.equal(isCompleteUkPostcode("cf242da"), true);
    assert.equal(isCompleteUkPostcode("CF24 2"), false);
  });

  it("takes the town from postcodes.io open data", () => {
    assert.equal(postcodesIoTown({ postcode: "CF24 2DA", admin_district: "Cardiff", parish: "Splott" }), "Cardiff");
  });

  it("prefers the village or town from Nominatim", () => {
    assert.equal(townFromNominatim({ address: { village: "Pontardawe", city: "Neath Port Talbot" } }), "Pontardawe");
  });

  it("builds selectable addresses from OpenStreetMap house tags", () => {
    const results = addressesFromOverpass(
      [
        { tags: { "addr:housenumber": "14", "addr:street": "Splott Road", "addr:city": "Cardiff", "addr:postcode": "CF24 2DA" } },
        { tags: { "addr:housenumber": "14", "addr:street": "Splott Road", "addr:city": "Cardiff", "addr:postcode": "CF24 2DA" } },
        { tags: { "addr:housenumber": "52", "addr:street": "Splott Road", "addr:city": "Cardiff" } },
        { tags: { name: "bus stop" } },
      ],
      "CF24 2DA",
      "Cardiff",
    );
    assert.equal(results.length, 2);
    assert.equal(results[0]?.line1, "14 Splott Road");
    assert.equal(results[1]?.line1, "52 Splott Road");
    assert.equal(results[0]?.town, "Cardiff");
    assert.equal(results[0]?.postcode, "CF24 2DA");
  });

  it("keeps untagged nearby houses only when they are on the same street", () => {
    const results = addressesFromOverpass(
      [
        { tags: { "addr:housenumber": "14", "addr:street": "Splott Road", "addr:postcode": "CF24 2DA" } },
        { tags: { "addr:housenumber": "16", "addr:street": "Splott Road" } },
        { tags: { "addr:housenumber": "1", "addr:street": "Marion Street" } },
      ],
      "CF24 2DA",
      "Cardiff",
    );
    assert.deepEqual(
      results.map((r) => r.line1),
      ["14 Splott Road", "16 Splott Road"],
    );
  });

  it("skips neighbouring postcodes and can fall back to the street name", () => {
    const results = addressesFromOverpass(
      [
        { tags: { "addr:housenumber": "1", "addr:street": "Other Road", "addr:postcode": "CF24 2DB" } },
        { tags: { highway: "residential", name: "Splott Road" } },
      ],
      "CF24 2DA",
      "Cardiff",
    );
    assert.equal(results.length, 1);
    assert.equal(results[0]?.line1, "Splott Road");
  });

  it("maps Ideal Postcodes PAF rows into selectable addresses", () => {
    const results = addressesFromIdealPostcodes([
      { line_1: "2 Church Street", post_town: "Pontardawe", postcode: "SA8 4HU" },
      { line_1: "1 Church Street", line_2: "Flat 1", post_town: "Pontardawe", postcode: "SA8 4HU" },
      { line_1: "", post_town: "Pontardawe", postcode: "SA8 4HU" },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.line1, "1 Church Street, Flat 1");
    assert.equal(results[1]?.line1, "2 Church Street");
    assert.equal(results[0]?.town, "Pontardawe");
  });
});
