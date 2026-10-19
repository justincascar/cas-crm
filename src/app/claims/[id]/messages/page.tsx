import { ClaimWorkScreen } from "../work/[screen]/page";

export default function ClaimMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Parameters<typeof ClaimWorkScreen>[0]["searchParams"];
}) {
  return ClaimWorkScreen({
    params: params.then(({ id }) => ({ id, screen: "comms" })),
    searchParams,
  });
}
