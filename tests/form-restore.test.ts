import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { describe, it } from "node:test";

const dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.HTMLSelectElement = window.HTMLSelectElement;
globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

describe("putting a saved draft back into the new-claim form (J16)", () => {
  it("fills React-managed boxes as if typed, leaves filled boxes and tick boxes alone, and skips hidden marks", async () => {
    const { createElement, act, useState } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { restoreDraftBoxes } = await import("../src/lib/form-restore.ts");

    function Form() {
      const [mobile, setMobile] = useState("");
      return createElement(
        "form",
        null,
        createElement("input", { name: "client_mobile", value: mobile, onChange: (event: { currentTarget: HTMLInputElement }) => setMobile(event.currentTarget.value) }),
        createElement("output", { id: "shown" }, mobile),
        createElement("input", { name: "client_forename", defaultValue: "" }),
        createElement("input", { name: "client_surname", defaultValue: "Already typed" }),
        createElement("select", { name: "veh_gearbox", defaultValue: "unknown" }, createElement("option", { value: "unknown" }, "Not known"), createElement("option", { value: "manual" }, "Manual")),
        createElement("textarea", { name: "circumstances", defaultValue: "" }),
        createElement("input", { name: "hireTaxi", type: "checkbox", value: "yes" }),
        createElement("input", { name: "draftId", type: "hidden", defaultValue: "" }),
      );
    }

    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(createElement(Form)));
    const form = document.querySelector("form")!;
    let filled = 0;
    await act(async () => {
      filled = restoreDraftBoxes(form, {
        client_mobile: "07700 900456",
        client_forename: "Bethan",
        client_surname: "Price",
        veh_gearbox: "manual",
        circumstances: "Hit from behind.",
        hireTaxi: "yes",
        draftId: "draft-elsewhere",
      });
    });
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    assert.equal(filled, 4);
    assert.equal(document.getElementById("shown")!.textContent, "07700 900456", "React state follows the restored box");
    assert.equal(value("client_forename"), "Bethan");
    assert.equal(value("client_surname"), "Already typed");
    assert.equal(value("veh_gearbox"), "manual");
    assert.equal(value("circumstances"), "Hit from behind.");
    assert.equal((form.elements.namedItem("hireTaxi") as HTMLInputElement).checked, false);
    assert.equal(value("draftId"), "");
    await act(async () => root.unmount());
  });
});
