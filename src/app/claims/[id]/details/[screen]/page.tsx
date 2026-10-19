import { ClaimVehiclesScreen } from "../../vehicles/page";
import { ClaimWorkScreen } from "../../work/[screen]/page";

export default async function ClaimDetailsScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; screen: string }>;
  searchParams: Parameters<typeof ClaimWorkScreen>[0]["searchParams"];
}) {
  const { id, screen } = await params;
  if (screen === "vehicles") return ClaimVehiclesScreen({ params: Promise.resolve({ id }) });
  return ClaimWorkScreen({ params: Promise.resolve({ id, screen }), searchParams });
}
