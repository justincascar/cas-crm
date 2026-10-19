import { notFound } from "next/navigation";
import { HireHeadScreen } from "../../heads/hire/page";
import { RecoveryHeadScreen } from "../../heads/recovery/page";
import { StorageHeadScreen } from "../../heads/storage/page";
import { VehicleDamageScreen } from "../../heads/vehicle/page";

export default async function ClaimMoneyHeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; head: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, head } = await params;
  const claim = Promise.resolve({ id });
  if (head === "recovery") {
    return RecoveryHeadScreen({ params: claim, searchParams: searchParams as Parameters<typeof RecoveryHeadScreen>[0]["searchParams"] });
  }
  if (head === "storage") {
    return StorageHeadScreen({ params: claim, searchParams: searchParams as Parameters<typeof StorageHeadScreen>[0]["searchParams"] });
  }
  if (head === "hire") {
    return HireHeadScreen({ params: claim, searchParams: searchParams as Parameters<typeof HireHeadScreen>[0]["searchParams"] });
  }
  if (head === "vehicle") {
    return VehicleDamageScreen({ params: claim, searchParams: searchParams as Parameters<typeof VehicleDamageScreen>[0]["searchParams"] });
  }
  notFound();
}
