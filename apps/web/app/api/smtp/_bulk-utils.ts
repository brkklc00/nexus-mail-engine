import { prisma } from "@nexus/db";

export type BulkSmtpScope = "all_active" | "selected" | "healthy" | "error";

export async function resolveSmtpScope(input: {
  scope: BulkSmtpScope;
  smtpAccountIds?: string[];
  onlyActive?: boolean;
}) {
  const scope = input.scope;
  const selectedIds = Array.from(new Set((input.smtpAccountIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
  const baseWhere: any = {
    isSoftDeleted: false
  };

  if (scope === "selected") {
    if (selectedIds.length === 0) {
      return { ids: [] as string[], totalMatched: 0 };
    }
    const rows = await prisma.smtpAccount.findMany({
      where: {
        ...baseWhere,
        id: { in: selectedIds },
        ...(input.onlyActive ? { isActive: true } : {})
      },
      select: { id: true }
    });
    return { ids: rows.map((row: { id: string }) => row.id), totalMatched: rows.length };
  }

  const whereByScope: Record<Exclude<BulkSmtpScope, "selected">, any> = {
    all_active: { isActive: true },
    healthy: {
      isActive: true,
      healthStatus: "healthy",
      isThrottled: false
    },
    error: {
      OR: [{ healthStatus: "error" }, { isThrottled: true }, { lastError: { not: null } }]
    }
  };

  const rows = await prisma.smtpAccount.findMany({
    where: {
      ...baseWhere,
      ...whereByScope[scope],
      ...(input.onlyActive ? { isActive: true } : {})
    },
    select: { id: true }
  });
  return { ids: rows.map((row: { id: string }) => row.id), totalMatched: rows.length };
}

