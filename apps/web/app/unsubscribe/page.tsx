import { PublicUnsubscribePage } from "@/components/unsubscribe/public-unsubscribe-page";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params?.token ? String(params.token) : null;
  return <PublicUnsubscribePage initialToken={token} />;
}

