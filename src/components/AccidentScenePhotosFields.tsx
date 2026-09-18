"use client";

import { useState } from "react";
import Link from "next/link";
import { actionRequestScenePhotosWhatsApp } from "@/app/actions";

const control = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function AccidentScenePhotosFields({
  claimId,
  defaultValue = "",
}: {
  claimId: string;
  defaultValue?: string;
}) {
  const [photos, setPhotos] = useState(defaultValue);

  return (
    <div className="sm:col-span-2 space-y-3">
      <label className="block text-sm">
        Were any photographs taken at the scene?
        <select
          name="photosAtScene"
          className={control}
          value={photos}
          onChange={(event) => setPhotos(event.currentTarget.value)}
        >
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
      {photos === "yes" ? (
        <div className="space-y-2 rounded-md border border-dashed border-line bg-paper p-3">
          <p className="text-sm">
            Ask the client to send those photographs in via WhatsApp. Nothing is sent to a live number until CAS&apos;s
            WhatsApp Business account is connected.
          </p>
          <button
            type="submit"
            formAction={actionRequestScenePhotosWhatsApp}
            className="rounded-md bg-navy px-4 py-2 text-sm text-white"
          >
            Ask for scene photographs via WhatsApp
          </button>
          <p className="text-xs text-slate">
            When the photographs arrive,{" "}
            <Link href={`/claims/${claimId}/work/comms`} className="font-semibold text-teal-dark">
              file the incoming WhatsApp
            </Link>
            . Photo files cannot be uploaded in this prototype.
          </p>
        </div>
      ) : null}
    </div>
  );
}
