export type AgreementPart = {
  included: boolean;
  reason: string;
};

export type HireAgreementParts = {
  hire: AgreementPart;
  storageRecovery: AgreementPart;
  termsAndCancel: AgreementPart;
  pageCount: number;
};

function statusText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

/** Storage or recovery counts only once CAS has actually arranged it. "Required" is not enough. */
export function describeHireAgreementParts(input: {
  hireAllocated: boolean;
  hireDescription: string;
  recoveryStatus: string | null | undefined;
  storageStatus: string | null | undefined;
  storageStartedOn: string | null | undefined;
  recoveryRecoveredAt: string | null | undefined;
  hasReservation: boolean;
}): HireAgreementParts {
  const hireDescription = input.hireDescription.trim();
  const hire: AgreementPart = input.hireAllocated
    ? {
        included: true,
        reason: `The hire vehicle page is included because a hire vehicle is allocated${hireDescription ? ` (${hireDescription})` : ""}.`,
      }
    : {
        included: false,
        reason: input.hasReservation
          ? "The hire vehicle page is not included. No hire vehicle is allocated. A reservation is on the file, and reserving a vehicle does not allocate it."
          : "The hire vehicle page is not included. No hire vehicle is allocated on this file.",
      };

  const recovery = statusText(input.recoveryStatus);
  const storage = statusText(input.storageStatus);
  const recoveryCarriedOut = recovery === "complete" || recovery === "completed" || Boolean(String(input.recoveryRecoveredAt || "").trim());
  const storageArranged = storage === "active" || storage === "ended" || Boolean(String(input.storageStartedOn || "").trim());
  const facts: string[] = [];
  if (recovery === "complete" || recovery === "completed") facts.push(`recovery is recorded as ${recovery === "completed" ? "completed" : "complete"}`);
  else if (String(input.recoveryRecoveredAt || "").trim()) facts.push("a recovery date is recorded on this file");
  if (storage === "active") facts.push("storage is active");
  else if (storage === "ended") facts.push("storage was arranged and has ended");
  else if (String(input.storageStartedOn || "").trim() && storage !== "active" && storage !== "ended") {
    facts.push("a storage start date is on the file");
  }

  let storageRecovery: AgreementPart;
  if (recoveryCarriedOut || storageArranged) {
    storageRecovery = {
      included: true,
      reason: `The Storage & Recovery page is included because ${facts.join(" and ")}.`,
    };
  } else if (recovery === "required") {
    storageRecovery = {
      included: false,
      reason:
        "The Storage & Recovery page is not included. Recovery is marked as required, but it has not been arranged through CAS, and storage has not started.",
    };
  } else {
    storageRecovery = {
      included: false,
      reason: "The Storage & Recovery page is not included. No storage or recovery has been arranged through CAS.",
    };
  }

  const termsAndCancel: AgreementPart = {
    included: true,
    reason:
      "The terms and the notice of the right to cancel are included with every agreement. They cover hire and storage together.",
  };
  const pageCount = 2 + (hire.included ? 1 : 0) + (storageRecovery.included ? 1 : 0);
  return { hire, storageRecovery, termsAndCancel, pageCount };
}
