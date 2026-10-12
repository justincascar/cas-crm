import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getClaimScreen } from "../src/lib/claim-screens.ts";
import { INDICATIVE_DEFAULTS } from "../src/lib/constants.ts";
import { valuesFromForm } from "../src/lib/db/screens.ts";
import { VEHICLE_CLASSES, VEHICLE_CLASS_LABELS } from "../src/lib/fleet/classes.ts";
import { screenSaveFieldError } from "../src/lib/db/screens.ts";
import {
  cardFeePence,
  extraDraftFromSaved,
  recoveryNetPence,
  recoveryVatAndTotal,
  shownExtraPounds,
  shownSomethingElsePounds,
  somethingElseGap,
  somethingElseSaveError,
  SOMETHING_ELSE_AMOUNT_MESSAGE,
  SOMETHING_ELSE_DESCRIPTION_MESSAGE,
} from "../src/lib/domain/recovery-charges.ts";

describe("recovery charge defaults", () => {
  it("uses the configured net defaults", () => {
    assert.equal(INDICATIVE_DEFAULTS.recovery_net_pence, 39500);
    assert.equal(INDICATIVE_DEFAULTS.storage_per_day_net_pence, 3900);
    assert.equal(INDICATIVE_DEFAULTS.ooh_net_pence, 10000);
    assert.equal(INDICATIVE_DEFAULTS.environmental_net_pence, 15000);
    assert.equal(INDICATIVE_DEFAULTS.winch_net_pence, 9500);
    assert.equal(INDICATIVE_DEFAULTS.card_fee_rate, 0.045);
  });

  it("fills each extra when ticked, drops it when unticked, and keeps an override", () => {
    let draft = { ticked: false, override: null as string | null };
    assert.equal(shownExtraPounds(draft, 10000), "");

    draft = { ...draft, ticked: true };
    assert.equal(shownExtraPounds(draft, 10000), "100.00");

    draft = { ...draft, override: "80.00" };
    assert.equal(shownExtraPounds(draft, 10000), "80.00");

    draft = { ...draft, ticked: false };
    assert.equal(shownExtraPounds(draft, 10000), "");
    assert.equal(draft.override, "80.00");

    draft = { ...draft, ticked: true };
    assert.equal(shownExtraPounds(draft, 10000), "80.00");
  });

  it("recalculates VAT and the total from the standard charge and the ticked extras", () => {
    const standardOnly = recoveryVatAndTotal(recoveryNetPence({ standardPounds: "395.00", extras: [] }));
    assert.equal(standardOnly.net, 39500);
    assert.equal(standardOnly.vat, 7900);
    assert.equal(standardOnly.gross, 47400);

    const allOn = recoveryVatAndTotal(
      recoveryNetPence({
        standardPounds: "400.00",
        extras: [
          { ticked: true, shownPounds: "100.00" },
          { ticked: true, shownPounds: "150.00" },
          { ticked: false, shownPounds: "95.00" },
        ],
      }),
    );
    assert.equal(allOn.net, 65000);
    assert.equal(allOn.vat, 13000);
    assert.equal(allOn.gross, 78000);
  });

  it("saves a ticked override, and an untick removes that fee without forgetting it", () => {
    const ticked = new FormData();
    ticked.set("standardCharge", "395.00");
    ticked.set("outOfHours", "yes");
    ticked.set("outOfHoursFee", "80.00");
    ticked.set("outOfHoursKept", "80.00");
    ticked.set("environment", "yes");
    ticked.set("environmentFee", "150.00");
    ticked.set("winch", "yes");
    ticked.set("winchFee", "95.00");
    const on = valuesFromForm(ticked, "recovery");
    assert.equal(on.standardCharge, "39500");
    assert.equal(on.outOfHoursFee, "8000");
    assert.equal(on.outOfHoursKept, "8000");
    assert.equal(on.environmentFee, "15000");
    assert.equal(on.winchFee, "9500");
    assert.equal(on.vat, "14400");
    assert.equal(on.total, "86400");

    const unticked = new FormData();
    unticked.set("standardCharge", "395.00");
    unticked.set("outOfHoursFee", "80.00");
    unticked.set("outOfHoursKept", "80.00");
    const off = valuesFromForm(unticked, "recovery");
    assert.equal(off.outOfHours, "");
    assert.equal(off.outOfHoursFee, "");
    assert.equal(off.outOfHoursKept, "8000");
    assert.equal(off.vat, "7900");
    assert.equal(off.total, "47400");

    const restored = extraDraftFromSaved({
      ticked: true,
      keptPence: off.outOfHoursKept,
      feePence: off.outOfHoursFee,
      defaultPence: INDICATIVE_DEFAULTS.ooh_net_pence,
    });
    assert.equal(shownExtraPounds(restored, INDICATIVE_DEFAULTS.ooh_net_pence), "80.00");
  });

  it("fills a blank standard charge from the £395 default and keeps a typed zero", () => {
    const blank = new FormData();
    const filled = valuesFromForm(blank, "recovery");
    assert.equal(filled.standardCharge, "39500");
    assert.equal(filled.vat, "7900");
    assert.equal(filled.total, "47400");

    const zero = new FormData();
    zero.set("standardCharge", "0.00");
    const cleared = valuesFromForm(zero, "recovery");
    assert.equal(cleared.standardCharge, "0");
    assert.equal(cleared.vat, "0");
    assert.equal(cleared.total, "0");
  });

  it("calculates the card fee at 4.5% and updates it when the other charges change", () => {
    const standardOnly = cardFeePence(39500);
    assert.equal(standardOnly, 1778);

    const blank = new FormData();
    blank.set("standardCharge", "395.00");
    blank.set("cardPayment", "yes");
    const calculated = valuesFromForm(blank, "recovery");
    assert.equal(calculated.cardPaymentFee, "1778");
    assert.equal(calculated.vat, String(recoveryVatAndTotal(39500 + 1778).vat));
    assert.equal(calculated.total, String(recoveryVatAndTotal(39500 + 1778).gross));

    const withWinch = new FormData();
    withWinch.set("standardCharge", "395.00");
    withWinch.set("winch", "yes");
    withWinch.set("winchFee", "95.00");
    withWinch.set("cardPayment", "yes");
    const updated = valuesFromForm(withWinch, "recovery");
    const winchSubtotal = 39500 + 9500;
    assert.equal(updated.cardPaymentFee, String(cardFeePence(winchSubtotal)));
    assert.notEqual(updated.cardPaymentFee, calculated.cardPaymentFee);
    assert.equal(updated.total, String(recoveryVatAndTotal(winchSubtotal + cardFeePence(winchSubtotal)).gross));
  });

  it("keeps a typed card fee when other charges change, and again after it is unticked", () => {
    const over = new FormData();
    over.set("standardCharge", "395.00");
    over.set("winch", "yes");
    over.set("winchFee", "95.00");
    over.set("cardPayment", "yes");
    over.set("cardPaymentFee", "20.00");
    over.set("cardPaymentKept", "20.00");
    const kept = valuesFromForm(over, "recovery");
    assert.equal(kept.cardPaymentFee, "2000");
    assert.equal(kept.cardPaymentKept, "2000");
    assert.notEqual(kept.cardPaymentFee, String(cardFeePence(39500 + 9500)));

    const off = new FormData();
    off.set("standardCharge", "395.00");
    off.set("cardPaymentKept", "20.00");
    const cleared = valuesFromForm(off, "recovery");
    assert.equal(cleared.cardPayment, "");
    assert.equal(cleared.cardPaymentFee, "");
    assert.equal(cleared.cardPaymentKept, "2000");
    assert.equal(cleared.total, "47400");

    const restored = extraDraftFromSaved({
      ticked: true,
      keptPence: cleared.cardPaymentKept,
      feePence: cleared.cardPaymentFee,
      defaultPence: cardFeePence(39500 + 9500),
    });
    assert.equal(shownExtraPounds(restored, cardFeePence(39500 + 9500)), "20.00");
  });

  it("adds something else only when the description and the amount are both entered", () => {
    const form = new FormData();
    form.set("standardCharge", "395.00");
    form.set("somethingElse", "yes");
    form.set("somethingElseDescription", "Tree removal from site");
    form.set("somethingElseFee", "75.00");
    form.set("somethingElseKept", "75.00");
    form.set("cardPayment", "yes");
    const saved = valuesFromForm(form, "recovery");
    assert.equal(saved.somethingElseFee, "7500");
    assert.equal(saved.somethingElseKept, "7500");
    assert.match(saved.somethingElseDescription, /tree removal from site/i);
    const subtotal = 39500 + 7500;
    assert.equal(saved.cardPaymentFee, String(cardFeePence(subtotal)));
    assert.equal(saved.total, String(recoveryVatAndTotal(subtotal + cardFeePence(subtotal)).gross));
    assert.equal(somethingElseSaveError(saved), null);

    let draft = { ticked: true, description: saved.somethingElseDescription, override: "75.00" as string | null };
    assert.equal(shownSomethingElsePounds(draft), "75.00");
    draft = { ...draft, ticked: false };
    assert.equal(shownSomethingElsePounds(draft), "");
    assert.equal(draft.override, "75.00");
    draft = { ...draft, ticked: true };
    assert.equal(shownSomethingElsePounds(draft), "75.00");
  });

  it("flags something else when only the description or only the amount is entered", () => {
    const descriptionOnly = new FormData();
    descriptionOnly.set("standardCharge", "395.00");
    descriptionOnly.set("somethingElse", "yes");
    descriptionOnly.set("somethingElseDescription", "Tree removal from site");
    const described = valuesFromForm(descriptionOnly, "recovery");
    assert.equal(described.somethingElseFee, "");
    assert.equal(described.total, "47400");
    assert.equal(somethingElseSaveError(described)?.field, "somethingElseFee");
    assert.equal(somethingElseSaveError(described)?.message, SOMETHING_ELSE_AMOUNT_MESSAGE);
    assert.equal(screenSaveFieldError("c-none", "recovery", described)?.message, SOMETHING_ELSE_AMOUNT_MESSAGE);

    const amountOnly = new FormData();
    amountOnly.set("standardCharge", "395.00");
    amountOnly.set("somethingElse", "yes");
    amountOnly.set("somethingElseFee", "75.00");
    const priced = valuesFromForm(amountOnly, "recovery");
    assert.equal(priced.somethingElseFee, "7500");
    assert.equal(priced.total, "47400");
    assert.equal(somethingElseSaveError(priced)?.field, "somethingElseDescription");
    assert.equal(somethingElseSaveError(priced)?.message, SOMETHING_ELSE_DESCRIPTION_MESSAGE);
    assert.equal(screenSaveFieldError("c-none", "recovery", priced)?.field, "somethingElseDescription");

    assert.equal(somethingElseGap({ ticked: true, description: "", amount: "" }), null);
    assert.equal(somethingElseGap({ ticked: false, description: "Tree", amount: "" }), null);
  });

  it("offers the fleet vehicle classes on the recovery screen", () => {
    const screen = getClaimScreen("recovery");
    const titles = screen?.sections.map((section) => section.title);
    assert.deepEqual(titles, ["Recoverer", "The recovery", "On collection", "Charges"]);
    const typeField = screen?.sections.flatMap((section) => section.fields).find((field) => field.name === "typeRecovered");
    assert.equal(typeField?.type, "select");
    for (const value of VEHICLE_CLASSES) {
      assert.equal(typeField?.options?.find((option) => option.value === value)?.label, VEHICLE_CLASS_LABELS[value]);
    }
  });
});
