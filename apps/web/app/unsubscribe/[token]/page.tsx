import { PublicUnsubscribePage } from "@/components/unsubscribe/public-unsubscribe-page";

export const dynamic = "force-dynamic";

export default async function UnsubscribeTokenPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicUnsubscribePage initialToken={token} />;
}

