"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * R59: a form sent with a mistake comes back with everything that was typed still in it.
 *
 * Every form in the CRM posts to a route or an action, which sends staff back to the page with ?error=… (and the R56
 * list of problems). The page is drawn again from the database, so the boxes used to come back empty or with the old
 * values. This keeps a copy of what was in the form when it was sent, in this browser tab only, and puts it back when
 * the page comes back with an error: text, amounts, dates and times, ticks, radio buttons and drop-downs. A chosen file
 * cannot be put back by a browser, so the box says "Please choose the file again".
 *
 * Not kept: hidden fields (each send has its own key and version), passwords, sign-in codes and bank details. The copy
 * is used once, within ten minutes, and removed when a page loads without an error.
 */

const STORE = "cas-form-keep";
const MAX_AGE_MS = 10 * 60 * 1000;
const NEVER_KEEP = /password|passcode|otp|totp|token|secret|sortcode|accountnumber|account_number|iban|cardnumber|cvv/i;

type Kept = {
  key: string;
  at: number;
  /** Every control name in the form when it was sent, so an unticked box is unticked again. */
  names: string[];
  values: Array<[string, string]>;
  files: string[];
};

function readStore(): Kept[] {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as Kept[]) : [];
    return Array.isArray(list) ? list.filter((item) => Date.now() - item.at < MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}

function writeStore(list: Kept[]) {
  try {
    if (list.length) window.sessionStorage.setItem(STORE, JSON.stringify(list.slice(-5)));
    else window.sessionStorage.removeItem(STORE);
  } catch {
    /* Private windows can refuse storage. The form still works; only the copy is lost. */
  }
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function keepable(control: Element): control is Control {
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return false;
  if (!control.name || control.disabled || NEVER_KEEP.test(control.name)) return false;
  if (control.closest("[data-no-keep]")) return false;
  if (control instanceof HTMLInputElement && ["hidden", "password", "submit", "button", "reset", "image"].includes(control.type)) return false;
  if (control.autocomplete === "one-time-code") return false;
  return true;
}

/** Hidden fields that change on every load (send keys, versions, copies of what was loaded) say nothing about which form it is. */
const VOLATILE_HIDDEN = /^\$ACTION|submitkey|version|loaded|json|token|draft/i;

/**
 * Which form this is, the same on the page it comes back to: where it posts (for a form with an address), the names
 * of its boxes, and the hidden fields that say which record it is for (the claim, the screen, the driver…). A form
 * that calls a server action has no address after the page is drawn in the browser, so the names carry it.
 */
function formKey(form: HTMLFormElement): string {
  const raw = form.getAttribute("action") || "";
  let target = "";
  if (raw && !raw.startsWith("javascript:")) {
    try {
      target = new URL(raw, window.location.href).pathname;
    } catch {
      target = raw;
    }
  }
  const names = [...new Set([...form.elements].filter(keepable).map((control) => control.name))].sort().join(",");
  const which = [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')]
    .filter((input) => input.name && !VOLATILE_HIDDEN.test(input.name) && input.value.length <= 80)
    .map((input) => `${input.name}=${input.value}`)
    .sort()
    .join("&");
  return `${target}|${names}|${which}`;
}

function keep(form: HTMLFormElement) {
  if (form.hasAttribute("data-no-keep") || (form.method || "").toLowerCase() === "get") return;
  const controls = [...form.elements].filter(keepable);
  if (!controls.length) return;
  const values: Array<[string, string]> = [];
  const files: string[] = [];
  for (const control of controls) {
    if (control instanceof HTMLInputElement) {
      if (control.type === "file") {
        if (control.files?.length) files.push(control.name);
        continue;
      }
      if ((control.type === "checkbox" || control.type === "radio") && !control.checked) continue;
      values.push([control.name, control.value]);
    } else if (control instanceof HTMLSelectElement && control.multiple) {
      for (const option of control.selectedOptions) values.push([control.name, option.value]);
    } else {
      values.push([control.name, control.value]);
    }
  }
  const key = formKey(form);
  const entry: Kept = { key, at: Date.now(), names: [...new Set(controls.map((control) => control.name))], values, files };
  writeStore([...readStore().filter((item) => item.key !== key), entry]);
}

function setValue(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  if (control.value === value) return;
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  // React keeps its own copy of the value; resetting it makes React see the change and update its state.
  const tracker = (control as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
  tracker?.setValue(control.value === "" ? "\u0000" : "");
  if (setter) setter.call(control, value);
  else control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function restoreInto(form: HTMLFormElement, kept: Kept): boolean {
  const byName = new Map<string, string[]>();
  for (const [name, value] of kept.values) byName.set(name, [...(byName.get(name) || []), value]);
  let touched = false;
  // The error list (R56) must not count a box as fixed just because its typed value was put back.
  form.setAttribute("data-restoring", "yes");
  for (const name of kept.names) {
    const wanted = byName.get(name) || [];
    const controls = [...form.elements].filter((control): control is Control => keepable(control) && control.name === name);
    let textIndex = 0;
    for (const control of controls) {
      if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
        const on = wanted.includes(control.value);
        if (control.checked !== on && !(control.type === "radio" && !on)) control.click();
        else if (control.type === "checkbox" && control.checked !== on) control.click();
        touched = true;
      } else if (control instanceof HTMLSelectElement && control.multiple) {
        for (const option of control.options) option.selected = wanted.includes(option.value);
        control.dispatchEvent(new Event("change", { bubbles: true }));
        touched = true;
      } else if (!(control instanceof HTMLInputElement && control.type === "file")) {
        const value = wanted[textIndex] ?? "";
        textIndex += 1;
        setValue(control, value);
        touched = true;
      }
    }
  }
  for (const name of kept.files) {
    const input = [...form.elements].find((control): control is HTMLInputElement => control instanceof HTMLInputElement && control.type === "file" && control.name === name);
    if (!input || input.parentElement?.querySelector("[data-choose-again]")) continue;
    const note = document.createElement("span");
    note.setAttribute("data-choose-again", name);
    note.className = "mt-1 block text-xs font-semibold text-overdue";
    note.textContent = "Please choose the file again. A browser cannot keep a chosen file after an error.";
    input.insertAdjacentElement("afterend", note);
  }
  form.removeAttribute("data-restoring");
  if (touched) form.setAttribute("data-kept-values", "yes");
  return touched;
}

/** The copy put back in the last few seconds, put back again if the page redraws the form before staff type in it. */
let recent: { kept: Kept[]; until: number } = { kept: [], until: 0 };
let typedSinceRestore = false;

function matchFor(form: HTMLFormElement, list: Kept[]): Kept | undefined {
  const key = formKey(form);
  // The same form, or the same form with a box more or less (a box shown only in some states).
  const [target, names, which] = key.split("|");
  const nameSet = new Set(String(names).split(","));
  return (
    list.find((item) => item.key === key) ||
    list.find((item) => {
      const [t, n, w] = item.key.split("|");
      if (t !== target || w !== which) return false;
      const theirs = String(n).split(",");
      const shared = theirs.filter((name) => nameSet.has(name)).length;
      return shared >= Math.max(1, Math.ceil(Math.max(theirs.length, nameSet.size) * 0.6));
    })
  );
}

/** Whether the form still shows the typed text values (ticks and choices aside). */
function holds(form: HTMLFormElement, kept: Kept): boolean {
  return kept.values.every(([name, value]) => {
    const control = [...form.elements].find((item): item is Control => keepable(item) && item.name === name);
    if (!control || (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio"))) return true;
    return control instanceof HTMLSelectElement && control.multiple ? true : control.value === value;
  });
}

function restore(): boolean {
  const list = readStore();
  const forms = [...document.querySelectorAll("form")];
  // A form redrawn after it was filled (part of the page loading late) is filled again, unless staff have typed since.
  if (!typedSinceRestore && Date.now() < recent.until) {
    for (const form of forms) {
      const kept = matchFor(form, recent.kept);
      if (kept && !holds(form, kept)) restoreInto(form, kept);
    }
  }
  if (!list.length) return true;
  let left = list;
  for (const form of forms) {
    const kept = matchFor(form, left);
    if (!kept) continue;
    if (restoreInto(form, kept)) {
      left = left.filter((item) => item !== kept);
      recent = { kept: [...recent.kept.filter((item) => item.key !== kept.key), kept], until: Date.now() + 4000 };
      typedSinceRestore = false;
    }
  }
  writeStore(left);
  return left.length < list.length;
}

/**
 * Listening starts as soon as this code loads, before the page has finished starting up, so a form sent quickly on a
 * slow page is still kept. Typing after a restore is noted so a late redraw never overwrites it.
 */
if (typeof document !== "undefined" && !(window as unknown as { __casFormKeeper?: boolean }).__casFormKeeper) {
  (window as unknown as { __casFormKeeper?: boolean }).__casFormKeeper = true;
  document.addEventListener(
    "submit",
    (event) => {
      if (event.target instanceof HTMLFormElement) keep(event.target);
    },
    true,
  );
  document.addEventListener(
    "input",
    (event) => {
      if (event.isTrusted) typedSinceRestore = true;
    },
    true,
  );
}

export function FormKeeper() {
  const pathname = usePathname();
  const search = useSearchParams();
  // "error", and the pages that name theirs (offerError, stepError, tlError…), and the R56 list of problems.
  const hasError = [...search.keys()].some((key) => key === "problems" || /(^e|E)rror$/.test(key));
  const hasClash = search.has("clash");

  useEffect(() => {
    // A save clash already shows what was typed beside what is stored (R-clash notice); leave that alone.
    if (!hasError || hasClash) {
      if (!hasError) writeStore([]);
      return;
    }
    // The page may still be drawing (folded sections, client forms, parts that load late). Keep trying for a few seconds.
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      tries += 1;
      restore();
      if (tries < 20) timer = window.setTimeout(attempt, 200);
    };
    timer = window.setTimeout(attempt, 50);
    return () => window.clearTimeout(timer);
  }, [pathname, search, hasError, hasClash]);

  return null;
}
