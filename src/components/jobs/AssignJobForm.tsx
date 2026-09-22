"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { roleLabel } from "@/lib/auth/roles";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base";

type Person = { id: string; name: string; role: string };
type Booking = { episode_id: string; file_reference: string | null; make: string | null; model: string | null; registration: string | null };
type Claim = { id: string; file_reference: string | null; registration: string | null };

const JOBS = [
  { kind: "hire_delivery", label: "Hire car delivery" },
  { kind: "hire_collection", label: "Hire car collection" },
  { kind: "client_recovery", label: "Recover client's vehicle" },
  { kind: "client_return", label: "Return client's vehicle after repair" },
  { kind: "repair", label: "Repair evidence" },
] as const;

export function AssignJobForm({
  action,
  today,
  people,
  bookings,
  claims,
  saved = false,
}: {
  action: string;
  today: string;
  people: Person[];
  bookings: Booking[];
  claims: Claim[];
  saved?: boolean;
}) {
  const [jobKind, setJobKind] = useState<string>("hire_delivery");
  const [assigneeId, setAssigneeId] = useState("");
  const [claimId, setClaimId] = useState("");
  const [hireEpisodeId, setHireEpisodeId] = useState("");
  const [workDate, setWorkDate] = useState(today);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const valuesRef = useRef({ jobKind, assigneeId, claimId, hireEpisodeId });
  valuesRef.current = { jobKind, assigneeId, claimId, hireEpisodeId };
  const ignoreSpuriousSelect = useRef(false);
  const drivers = people.filter((person) => person.role === "driver");
  const needsHire = jobKind === "hire_delivery" || jobKind === "hire_collection";
  const canComplete = jobKind !== "repair" && workDate <= today;
  const assignees = jobKind === "repair" ? people : drivers;
  const assigneeStillListed = assignees.some((person) => person.id === assigneeId);

  function keepSelect(event: ChangeEvent<HTMLSelectElement>, current: string, apply: (value: string) => void) {
    if (ignoreSpuriousSelect.current || document.activeElement !== event.currentTarget) {
      event.currentTarget.value = current;
      return;
    }
    apply(event.target.value);
  }

  function onCompletedChange(event: ChangeEvent<HTMLInputElement>) {
    ignoreSpuriousSelect.current = true;
    setCompleted(event.target.checked);
    queueMicrotask(() => {
      ignoreSpuriousSelect.current = false;
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (savingRef.current) {
      event.preventDefault();
      return;
    }
    savingRef.current = true;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    setSaving(true);
  }

  return (
    <form method="post" action={action} className="space-y-3 rounded-xl border border-line bg-card p-5" onSubmit={onSubmit}>
      <h2 className="font-serif text-xl text-navy-deep">Assign a job</h2>
      <p className="text-sm text-slate">
        Choose the driver and the date yourself. Nothing here is assigned automatically. The driver sees the job on My jobs today only when that date is today.
      </p>
      <label className="block text-sm">
        Job
        <select
          name="jobKind"
          className={field}
          required
          value={jobKind}
          onChange={(event) => keepSelect(event, valuesRef.current.jobKind, setJobKind)}
        >
          {JOBS.map((job) => (
            <option key={job.kind} value={job.kind}>
              {job.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        {jobKind === "repair" ? "Person" : "Driver"}
        <select
          name="assigneeId"
          className={field}
          required
          value={assigneeStillListed ? assigneeId : ""}
          onChange={(event) => keepSelect(event, valuesRef.current.assigneeId, setAssigneeId)}
        >
          <option value="" disabled>
            Choose one
          </option>
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {jobKind === "repair" ? ` · ${roleLabel(person.role)}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Date
        <input
          name="workDate"
          type="date"
          required
          className={field}
          value={workDate}
          onChange={(event) => setWorkDate(event.target.value)}
        />
      </label>
      <p className="text-sm text-slate">Today is filled in. Change it to any earlier or later day. A past date does not appear on My jobs today.</p>
      <label className={needsHire ? "block text-sm" : "hidden"}>
          Hire booking
          <select
            name="hireEpisodeId"
            className={field}
            required={needsHire}
            disabled={!needsHire}
            value={hireEpisodeId}
            onChange={(event) => keepSelect(event, valuesRef.current.hireEpisodeId, setHireEpisodeId)}
          >
            <option value="" disabled>
              Choose one
            </option>
            {bookings.map((booking) => (
              <option key={booking.episode_id} value={booking.episode_id}>
                {booking.file_reference} · {[booking.make, booking.model, booking.registration].filter(Boolean).join(" ") || "Hire vehicle"}
              </option>
            ))}
          </select>
        </label>
      <label className={needsHire ? "hidden" : "block text-sm"}>
          File
          <select
            name="claimId"
            className={field}
            required={!needsHire}
            disabled={needsHire}
            value={claimId}
            onChange={(event) => keepSelect(event, valuesRef.current.claimId, setClaimId)}
          >
            <option value="" disabled>
              Choose a file
            </option>
            {claims.map((claim) => (
              <option key={claim.id} value={claim.id}>
                {claim.file_reference}
                {claim.registration ? ` · ${claim.registration}` : ""}
              </option>
            ))}
          </select>
        </label>
      {canComplete ? (
        <div className="space-y-3 rounded-md border border-line bg-white p-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="completed"
              value="1"
              className="mt-1"
              checked={completed}
              onChange={onCompletedChange}
            />
            <span>Already completed. Log the driver who did it and when it happened.</span>
          </label>
          <div className={completed ? "space-y-3" : "hidden"}>
            <label className="block text-sm">
              Driver who did this
              <select name="actualDriverId" className={field} required={completed} disabled={!completed} defaultValue="">
                <option value="">Choose the driver</option>
                {drivers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Date and time this happened
              <input name="actualOccurredAt" type="datetime-local" required={completed} disabled={!completed} className={field} defaultValue="" />
            </label>
            <p className="text-sm text-slate">
              Leave this as the real time, including a job from a previous day. It is not filled in with now, and it is not the person signed in.
            </p>
          </div>
        </div>
      ) : null}
      {saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-base font-semibold">
          Job assigned. It is saved. You do not need to press the button again.
        </p>
      ) : null}
      <button className="min-h-11 w-full rounded-md bg-teal px-4 py-3 text-base font-semibold text-white disabled:opacity-60 sm:w-auto" type="submit" disabled={saving}>
        {saving ? "Assigning…" : "Assign job"}
      </button>
    </form>
  );
}
