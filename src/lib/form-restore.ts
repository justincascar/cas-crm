/**
 * Puts a saved new-claim draft back into the form's boxes (J16; it also restores drafts that were only half put back
 * before). Many boxes are managed by React, so each value is set the way typing would set it: through the browser's
 * own value setter, followed by the input and change events React listens for.
 */

const NOT_RESTORED = new Set(["draftId", "draftVersion", "recoveryFormVersion", "agreementChannel", "websiteEnquiryId"]);

function setLikeTyping(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Fills empty boxes (and drop-downs still on another choice) from the saved values. Returns how many were filled. */
export function restoreDraftBoxes(form: HTMLFormElement, values: Record<string, string>): number {
  let filled = 0;
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
    const name = element.name;
    if (!name || NOT_RESTORED.has(name) || !(name in values)) continue;
    const value = values[name];
    if (!value) continue;
    if (element instanceof HTMLInputElement) {
      // Tick boxes and choices already come back from the saved draft; files and hidden marks are never restored.
      if (["checkbox", "radio", "file", "hidden", "submit", "button"].includes(element.type)) continue;
      if (element.value !== "") continue;
    } else if (element instanceof HTMLSelectElement) {
      if (element.value === value || !Array.from(element.options).some((option) => option.value === value)) continue;
    } else if (element.value !== "") {
      continue;
    }
    setLikeTyping(element, value);
    filled += 1;
  }
  return filled;
}
