const field = "mt-1 w-full max-w-full rounded-md border border-line bg-white px-3 py-3 text-base";
const cameraClass =
  "block w-full text-[0px] file:min-h-11 file:w-full file:cursor-pointer file:rounded-md file:border-0 file:bg-navy file:px-3 file:py-3 file:text-base file:font-semibold file:text-transparent";

function hiddenFields({ claimId, handoverId, slot }: { claimId: string; handoverId: string; slot: string }) {
  return (
    <>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="handoverId" value={handoverId} />
      <input type="hidden" name="slot" value={slot} />
    </>
  );
}

/** A normal form post. The page script sends it when the camera returns. A React listener is missed after the phone camera closes. */
export function ShotCamera({
  action,
  claimId,
  handoverId,
  slot,
  cameraLabel,
}: {
  action: string;
  claimId: string;
  handoverId: string;
  slot: string;
  cameraLabel: string;
}) {
  const fields = { claimId, handoverId, slot };

  return (
    <div className="grid gap-3">
      <form method="post" action={action} encType="multipart/form-data">
        {hiddenFields(fields)}
        <div className="relative">
          <input
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            aria-label={cameraLabel}
            className={cameraClass}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-base font-semibold text-white">
            {cameraLabel}
          </span>
        </div>
      </form>
      <form method="post" action={action} encType="multipart/form-data">
        {hiddenFields(fields)}
        <label className="block text-sm text-slate">
          Or choose a saved photo
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" className={field} />
        </label>
      </form>
    </div>
  );
}
