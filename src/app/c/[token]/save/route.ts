import { NextResponse } from "next/server";
import { CLIENT_FORM_FIELDS, saveClientForm, uploadClientFile } from "@/lib/db/client-form";
import { browserOrigin } from "@/lib/http/browser-origin";

/** The client's form: every button saves what they typed first, so adding a photo never loses their answers. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const back = new URL(`/c/${token}`, browserOrigin(request));
  try {
    const form = await request.formData();
    const intent = String(form.get("intent") || "save");
    const values = Object.fromEntries(CLIENT_FORM_FIELDS.map((field) => [field.name, String(form.get(field.name) || "")]));
    // The answers are saved before the file is checked, so a refused file never loses what they typed.
    saveClientForm({ token, values, send: false });
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      uploadClientFile({ token, kind: String(form.get("kind") || ""), file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type } });
      back.searchParams.set("added", "1");
    } else if (intent === "add") {
      throw new Error("Choose a photo or PDF first, then press Add this file.");
    }
    if (intent === "send") {
      saveClientForm({ token, values, send: true });
      back.searchParams.set("sent", "1");
    } else {
      back.searchParams.set("saved", "1");
    }
    if (intent === "add") back.hash = "files";
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "That did not save. Please try again.");
  }
  return NextResponse.redirect(back, 303);
}
