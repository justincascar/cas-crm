import { redirect } from "next/navigation";
import { headScreenPath } from "@/lib/domain/head-screen";

/** Old combined address. Recovery and storage now have their own pages. */
export default async function RecoveryStorageRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ head?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const head = query.head === "recovery" ? "recovery" : "storage";
  redirect(headScreenPath(id, head));
}
