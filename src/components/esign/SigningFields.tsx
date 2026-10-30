import { SignaturePad } from "@/components/handover/SignaturePad";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base";

/** Name, signature and the agreement tick. Shared by the link page and the doorstep page. */
export function SigningFields({ defaultName, agreementName = "hire agreement" }: { defaultName: string; agreementName?: string }) {
  return (
    <div className="space-y-4">
      <label className="block text-base">
        Full name
        <input name="signerName" required autoComplete="name" defaultValue={defaultName} className={field} />
      </label>
      <div className="text-base">
        Signature
        <SignaturePad />
      </div>
      <label className="flex items-start gap-3 text-base">
        <input type="checkbox" name="agreed" value="yes" required className="mt-1 h-5 w-5" />
        I have read the {agreementName} above and I agree to its terms.
      </label>
    </div>
  );
}
