import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { pathWithClash, VersionConflictError } from "@/lib/db/record-version";

/** Server actions. redirect() throws, so call this before any other catch handling. */
export function redirectClash(path: string, error: unknown): void {
  if (error instanceof VersionConflictError) redirect(pathWithClash(path, error));
}

/** Route handlers. Returns a redirect when the save was refused, otherwise null. */
export function clashRedirect(origin: string, path: string, error: unknown): NextResponse | null {
  if (!(error instanceof VersionConflictError)) return null;
  return NextResponse.redirect(new URL(pathWithClash(path, error), origin), 303);
}
