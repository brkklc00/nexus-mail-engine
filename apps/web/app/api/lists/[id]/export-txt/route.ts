import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

type ExportType = "all" | "valid" | "invalid" | "unsuppressed";

const BATCH_SIZE = 5000;

type ExportMembershipRow = {
  id: string;
  recipient: {
    email: string;
    emailNormalized: string;
  };
};

type SuppressedRow = {
  emailNormalized: string;
};

function parseExportType(raw: string | null): ExportType {
  if (raw === "valid" || raw === "invalid" || raw === "unsuppressed") {
    return raw;
  }
  return "all";
}

function toSafeFileBase(name: string): string {
  return name
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "list";
}

function filenameForType(base: string, type: ExportType): string {
  if (type === "all") {
    return `${base}-emails.txt`;
  }
  return `${base}-${type}-emails.txt`;
}

function whereByType(type: ExportType, listId: string) {
  if (type === "valid") {
    return {
      listId,
      recipient: { status: { not: "invalid" } }
    };
  }
  if (type === "invalid") {
    return {
      listId,
      recipient: { status: "invalid" }
    };
  }
  return { listId };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id: listId } = await params;
  const type = parseExportType(new URL(request.url).searchParams.get("type"));

  const list = await prisma.recipientList.findUnique({
    where: { id: listId },
    select: { id: true, name: true }
  });

  if (!list) {
    return Response.json({ ok: false, error: "List not found" }, { status: 404 });
  }

  const safeBase = toSafeFileBase(list.name);
  const filename = filenameForType(safeBase, type);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cursorId: string | undefined;
      try {
        while (true) {
          const rows = (await prisma.recipientListMembership.findMany({
            where: whereByType(type, listId),
            orderBy: { id: "asc" },
            take: BATCH_SIZE,
            ...(cursorId
              ? {
                  cursor: { id: cursorId },
                  skip: 1
                }
              : {}),
            select: {
              id: true,
              recipient: {
                select: {
                  email: true,
                  emailNormalized: true
                }
              }
            }
          })) as ExportMembershipRow[];

          if (rows.length === 0) {
            break;
          }

          cursorId = rows[rows.length - 1]?.id;
          let suppressedSet: Set<string> | null = null;
          if (type === "unsuppressed") {
            const emailNormalized = rows
              .map((row) => row.recipient.emailNormalized)
              .filter((value): value is string => typeof value === "string" && value.length > 0);
            if (emailNormalized.length > 0) {
              const suppressedRows = (await prisma.suppressionEntry.findMany({
                where: {
                  emailNormalized: { in: emailNormalized },
                  OR: [{ scope: "global" }, { scope: "list", listId }]
                },
                select: { emailNormalized: true }
              })) as SuppressedRow[];
              suppressedSet = new Set(suppressedRows.map((item: SuppressedRow) => item.emailNormalized));
            } else {
              suppressedSet = new Set();
            }
          }

          for (const row of rows) {
            const emailRaw = row.recipient.email?.trim().toLowerCase();
            if (!emailRaw) {
              continue;
            }
            if (suppressedSet?.has(row.recipient.emailNormalized)) {
              continue;
            }
            controller.enqueue(encoder.encode(`${emailRaw}\n`));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
