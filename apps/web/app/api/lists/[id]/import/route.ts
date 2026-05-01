import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z
  .object({
    text: z.string().min(1).optional(),
    emails: z.array(z.string().min(1)).min(1).max(12000).optional(),
    dedupeGlobally: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    if (!value.text && (!value.emails || value.emails.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either text or emails must be provided"
      });
    }
  });

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;
const emailHeaderAliases = new Set([
  "email",
  "e mail",
  "mail",
  "mail address",
  "email address",
  "mail adresi",
  "eposta",
  "e posta",
  "correo",
  "address"
]);

type Candidate = {
  email: string;
  emailNormalized: string;
  name?: string;
};

type ParsedCandidates = {
  totalProcessed: number;
  candidates: Candidate[];
  invalidSkipped: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeHeaderLabel(input: string): string {
  return input
    .trim()
    .replace(/^["']|["']$/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectDelimiter(line: string): "," | ";" | "\t" | null {
  const counts: Array<{ delimiter: "," | ";" | "\t"; count: number }> = [
    { delimiter: ",", count: (line.match(/,/g) ?? []).length },
    { delimiter: ";", count: (line.match(/;/g) ?? []).length },
    { delimiter: "\t", count: (line.match(/\t/g) ?? []).length }
  ];
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delimiter : null;
}

function splitCsvRow(line: string, delimiter: "," | ";" | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function extractEmailsFromToken(token: string): string[] {
  const clean = token.trim();
  if (!clean) return [];
  const matches = clean.match(emailRegex);
  if (!matches || matches.length === 0) return [clean];
  return matches.map((m) => {
    const wrapped = clean.match(/^(.*)<\s*([^>]+)\s*>$/);
    if (wrapped && wrapped[2]?.toLowerCase() === m.toLowerCase()) {
      return `${m}|${wrapped[1].trim().replace(/^"|"$/g, "")}`;
    }
    return m;
  });
}

function extractCsvEmailColumnTokens(text: string): string[] | null {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];
  const delimiter = detectDelimiter(lines[0]);
  if (!delimiter) return null;

  const headerCells = splitCsvRow(lines[0], delimiter).map((cell) => normalizeHeaderLabel(cell));
  const emailColumnIndex = headerCells.findIndex((header) => emailHeaderAliases.has(header));
  if (emailColumnIndex < 0) return null;

  const extracted: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvRow(line, delimiter);
    const cellValue = cells[emailColumnIndex]?.trim() ?? "";
    if (!cellValue) continue;
    extracted.push(...extractEmailsFromToken(cellValue));
  }

  return extracted;
}

function parseCandidates(text: string): ParsedCandidates {
  const csvEmailTokens = extractCsvEmailColumnTokens(text);
  const rawTokens =
    csvEmailTokens ??
    text
      .replace(/[;\t]+/g, "\n")
      .split(/\r?\n/)
      .flatMap((line) => extractEmailsFromToken(line));

  let invalidSkipped = 0;
  const output: Candidate[] = [];
  for (const token of rawTokens) {
    const [emailRaw, nameRaw] = token.split("|");
    const normalized = emailRaw.trim().toLowerCase();
    const valid = z.string().email().safeParse(normalized).success;
    if (!valid) {
      invalidSkipped += 1;
      continue;
    }
    output.push({
      email: emailRaw.trim(),
      emailNormalized: normalized,
      name: nameRaw?.trim() || undefined
    });
  }
  return { totalProcessed: rawTokens.length, candidates: output, invalidSkipped };
}

function parseCandidateEmails(emails: string[]): ParsedCandidates {
  let invalidSkipped = 0;
  const output: Candidate[] = [];

  for (const raw of emails) {
    for (const token of extractEmailsFromToken(raw)) {
      const [emailRaw] = token.split("|");
      const normalized = emailRaw.trim().toLowerCase();
      const valid = z.string().email().safeParse(normalized).success;
      if (!valid) {
        invalidSkipped += 1;
        continue;
      }
      output.push({
        email: normalized,
        emailNormalized: normalized
      });
    }
  }

  return {
    totalProcessed: emails.length,
    candidates: output,
    invalidSkipped
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const list = await prisma.recipientList.findUnique({ where: { id: listId } });
  if (!list) {
    return NextResponse.json({ ok: false, error: "List not found" }, { status: 404 });
  }

  const parsedData = parsed.data.emails ? parseCandidateEmails(parsed.data.emails) : parseCandidates(parsed.data.text ?? "");
  const seen = new Set<string>();
  const dedupedInput: Candidate[] = [];
  let duplicateInInput = 0;
  for (const candidate of parsedData.candidates) {
    if (seen.has(candidate.emailNormalized)) {
      duplicateInInput += 1;
      continue;
    }
    seen.add(candidate.emailNormalized);
    dedupedInput.push(candidate);
  }

  const normalizedEmails = dedupedInput.map((item) => item.emailNormalized);
  if (normalizedEmails.length === 0) {
    return NextResponse.json({
      ok: true,
      result: {
        totalProcessed: parsedData.totalProcessed,
        added: 0,
        duplicateSkipped: duplicateInInput,
        invalidSkipped: parsedData.invalidSkipped,
        alreadySuppressedSkipped: 0,
        alreadyInListSkipped: 0,
        alreadyInOtherListsSkipped: 0,
        capacitySkipped: 0
      }
    });
  }

  const alreadyInList = new Set<string>();
  const alreadyInOtherLists = new Set<string>();
  const suppressed = new Set<string>();

  for (const emailChunk of chunk(normalizedEmails, 1000)) {
    const [inListRows, inAnyRows, suppressedRows] = await Promise.all([
      prisma.recipientListMembership.findMany({
        where: { listId, recipient: { emailNormalized: { in: emailChunk } } },
        include: { recipient: { select: { emailNormalized: true } } }
      }),
      parsed.data.dedupeGlobally
        ? prisma.recipientListMembership.findMany({
            where: {
              recipient: { emailNormalized: { in: emailChunk } }
            },
            include: { recipient: { select: { emailNormalized: true } } }
          })
        : Promise.resolve([] as any[]),
      prisma.suppressionEntry.findMany({
        where: {
          emailNormalized: { in: emailChunk },
          OR: [{ scope: "global" }, { scope: "list", listId }]
        },
        select: { emailNormalized: true }
      })
    ]);

    for (const row of inListRows as any[]) alreadyInList.add(row.recipient.emailNormalized);
    for (const row of inAnyRows as any[]) alreadyInOtherLists.add(row.recipient.emailNormalized);
    for (const row of suppressedRows) suppressed.add(row.emailNormalized);
  }

  const importable = dedupedInput.filter((candidate) => {
    if (alreadyInList.has(candidate.emailNormalized)) return false;
    if (suppressed.has(candidate.emailNormalized)) return false;
    if (parsed.data.dedupeGlobally && alreadyInOtherLists.has(candidate.emailNormalized)) return false;
    return true;
  });

  const existingCount = await prisma.recipientListMembership.count({ where: { listId } });
  const availableCapacity = Math.max(0, list.maxSize - existingCount);
  const cappedImportable = importable.slice(0, availableCapacity);
  const capacitySkipped = importable.length - cappedImportable.length;

  let added = 0;
  for (const candidateChunk of chunk(cappedImportable, 500)) {
    const emailSet = candidateChunk.map((item) => item.emailNormalized);
    const existingRecipients = await prisma.recipient.findMany({
      where: { emailNormalized: { in: emailSet } },
      select: { id: true, emailNormalized: true }
    });
    const existingMap = new Map(existingRecipients.map((r: { emailNormalized: string; id: string }) => [r.emailNormalized, r.id]));

    const newRecipients = candidateChunk.filter((item) => !existingMap.has(item.emailNormalized));
    if (newRecipients.length > 0) {
      await prisma.recipient.createMany({
        data: newRecipients.map((item) => ({
          email: item.email,
          emailNormalized: item.emailNormalized,
          name: item.name ?? null,
          status: "active",
          tags: []
        })),
        skipDuplicates: true
      });
    }

    const resolvedRecipients = await prisma.recipient.findMany({
      where: { emailNormalized: { in: emailSet } },
      select: { id: true, emailNormalized: true }
    });

    const created = await prisma.recipientListMembership.createMany({
      data: resolvedRecipients.map((r: { id: string }) => ({
        listId,
        recipientId: r.id
      })),
      skipDuplicates: true
    });
    added += created.count;
  }

  const result = {
    totalProcessed: parsedData.totalProcessed,
    added,
    duplicateSkipped: duplicateInInput,
    invalidSkipped: parsedData.invalidSkipped,
    alreadySuppressedSkipped: suppressed.size,
    alreadyInListSkipped: alreadyInList.size,
    alreadyInOtherListsSkipped: parsed.data.dedupeGlobally ? alreadyInOtherLists.size : 0,
    capacitySkipped
  };

  await writeAuditLog(session.userId, "list.import_bulk", "recipient_list", {
    listId,
    ...result,
    dedupeGlobally: parsed.data.dedupeGlobally
  });

  return NextResponse.json({ ok: true, result });
}
