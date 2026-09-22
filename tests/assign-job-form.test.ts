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
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.Node = window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

function field(name: string) {
  const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!element) throw new Error(`Missing ${name}`);
  return element;
}

describe("assign a job form", () => {
  it("keeps the job, driver and file after Already completed is ticked and filled in", async () => {
    const { createElement, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { AssignJobForm } = await import("../src/components/jobs/AssignJobForm.tsx");
    async function setField(name: string, value: string) {
      const element = field(name);
      await act(async () => {
        element.focus();
        element.value = value;
        element.dispatchEvent(new window.Event("input", { bubbles: true }));
        element.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    }
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        createElement(AssignJobForm, {
          action: "/jobs/assign",
          today: "2026-09-22",
          people: [
            { id: "staff-driver", name: "Demo Driver", role: "driver" },
            { id: "staff-justin", name: "Justin Roberts", role: "administrator" },
          ],
          bookings: [{ episode_id: "h-c3", file_reference: "TEST-0003", make: "Volkswagen", model: "Golf", registration: "CAS 2" }],
          claims: [{ id: "c3", file_reference: "TEST-0003", registration: "SA12 CWA" }],
        }),
      );
    });

    assert.ok(document.querySelector('[name="actualDriverId"]'));
    await setField("jobKind", "client_return");
    await setField("assigneeId", "staff-driver");
    await setField("claimId", "c3");
    await act(async () => {
      field("completed").click();
      const job = field("jobKind");
      const driver = field("assigneeId");
      job.value = "hire_delivery";
      driver.value = "";
      job.dispatchEvent(new window.Event("change", { bubbles: true }));
      driver.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.equal(field("jobKind").value, "client_return");
    assert.equal(field("assigneeId").value, "staff-driver");
    assert.equal(field("claimId").value, "c3");
    await setField("actualDriverId", "staff-driver");
    await setField("actualOccurredAt", "2026-09-18T16:30");
    await setField("workDate", "2026-09-18");

    assert.equal(field("jobKind").value, "client_return");
    assert.equal(field("assigneeId").value, "staff-driver");
    assert.equal(field("claimId").value, "c3");
    assert.equal((field("completed") as HTMLInputElement).checked, true);
    assert.equal(field("actualDriverId").value, "staff-driver");
    assert.equal(field("actualOccurredAt").value, "2026-09-18T16:30");
    assert.equal(field("workDate").value, "2026-09-18");

    await setField("jobKind", "client_recovery");
    assert.equal(field("jobKind").value, "client_recovery");
    assert.equal(field("assigneeId").value, "staff-driver");
    assert.equal(field("claimId").value, "c3");
    assert.equal((field("completed") as HTMLInputElement).checked, true);
    assert.equal(field("actualDriverId").value, "staff-driver");

    await act(async () => {
      root.render(
        createElement(AssignJobForm, {
          action: "/jobs/assign",
          saved: true,
          today: "2026-09-22",
          people: [
            { id: "staff-driver", name: "Demo Driver", role: "driver" },
            { id: "staff-justin", name: "Justin Roberts", role: "administrator" },
          ],
          bookings: [{ episode_id: "h-c3", file_reference: "TEST-0003", make: "Volkswagen", model: "Golf", registration: "CAS 2" }],
          claims: [{ id: "c3", file_reference: "TEST-0003", registration: "SA12 CWA" }],
        }),
      );
    });
    const form = document.querySelector('form[action="/jobs/assign"]');
    if (!form) throw new Error("Missing assign form");
    assert.match(form.textContent || "", /Job assigned\. It is saved\. You do not need to press the button again\./);
    const button = form.querySelector('button[type="submit"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Missing assign button");
    assert.equal(button.disabled, false);
    form.addEventListener("submit", (event) => event.preventDefault());
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(button.disabled, true);
    assert.match(button.textContent || "", /Assigning/);

    await act(async () => {
      root.unmount();
    });
  });
});
