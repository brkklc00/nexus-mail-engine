type CampaignDetailPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

function getCampaignStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Bekliyor",
    queued: "Kuyrukta",
    running: "Calisiyor",
    paused: "Duraklatildi",
    completed: "Tamamlandi",
    partially_completed: "Kismen Tamamlandi",
    failed: "Basarisiz",
    canceled: "Iptal Edildi"
  };
  return map[status] ?? status;
}

export default async function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  const { id } = await params;
  const { prisma } = await import("@nexus/db");
  const [campaign, clickGroups] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id },
      include: {
        template: true,
        smtpAccount: true,
        logs: { orderBy: { createdAt: "desc" }, take: 20 }
      }
    }),
    prisma.clickEvent.groupBy({
      by: ["campaignLinkId"],
      where: { campaignId: id, campaignLinkId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { campaignLinkId: "desc" } },
      take: 5
    })
  ]);

  if (!campaign) {
    return <div className="rounded-lg border border-border bg-card p-6 text-zinc-300">Kampanya bulunamadi.</div>;
  }

  const completionBase = campaign.totalTargeted || 1;
  const progress = Math.min(
    100,
    Number((((campaign.totalSent + campaign.totalFailed + campaign.totalSkipped) / completionBase) * 100).toFixed(2))
  );
  const topLinks = await Promise.all(
    clickGroups.map(async (group: any) => {
      const link = await prisma.campaignLink.findUnique({
        where: { id: group.campaignLinkId }
      });
      return {
        id: group.campaignLinkId,
        url: link?.originalUrl ?? "-",
        totalClicks: group._count._all
      };
    })
  );
  const totalClicks = await prisma.clickEvent.count({ where: { campaignId: id } });
  const uniqueClicks = await prisma.clickEvent.groupBy({
    by: ["recipientId"],
    where: { campaignId: id }
  });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-xl font-semibold text-white">{campaign.name}</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Durum: {getCampaignStatusLabel(campaign.status)} · Saglayici: {campaign.provider} · SMTP: {campaign.smtpAccount.name}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Hedeflenen" value={campaign.totalTargeted} />
        <Metric label="Gonderilen" value={campaign.totalSent} />
        <Metric label="Basarisiz" value={campaign.totalFailed} />
        <Metric label="Atlanan" value={campaign.totalSkipped} />
        <Metric label="Acilan" value={campaign.totalOpened} />
        <Metric label="Benzersiz Tiklanan" value={campaign.totalClicked} />
        <Metric label="Toplam Tiklama" value={totalClicks} />
        <Metric label="Uyelikten Cikan" value={campaign.unsubscribeCount} />
        <Metric label="Benzersiz Tiklayan Alici" value={uniqueClicks.length} />
        <Metric label="Ilerleme" value={`${progress}%`} />
      </div>

      <div className="rounded-md border border-border bg-zinc-900/50 p-3">
        <p className="text-xs uppercase tracking-wider text-zinc-400">En Cok Tiklanan Linkler</p>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          {topLinks.map((item) => (
            <p key={item.id}>
              {item.totalClicks} tiklama · {item.url}
            </p>
          ))}
          {topLinks.length === 0 ? <p>Henuz tiklama verisi yok.</p> : null}
        </div>
      </div>

      <div className="rounded-md border border-border bg-zinc-900/50 p-3">
        <p className="text-xs uppercase tracking-wider text-zinc-400">Son Teslimat Kayitlari</p>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          {campaign.logs.map((log: any) => (
            <p key={log.id}>
              [{new Date(log.createdAt).toLocaleTimeString()}] {log.eventType} · {log.status} · {log.message ?? "-"}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-zinc-900/50 p-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
