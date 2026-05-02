import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { encryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  lines: z.string(),
  updateExisting: z.boolean().default(false)
});

const emailSchema = z.string().email();

type ParsedEntry = {
  lineNumber: number;
  fromEmail: string;
  username: string;
  password: string;
};

function parseInputLines(raw: string) {
  const lines = raw.replace(/\r/g, "").split("\n");
  const parsed: ParsedEntry[] = [];
  const errors: string[] = [];
  let scanned = 0;
  let invalid = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    scanned += 1;
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      invalid += 1;
      errors.push(`Line ${i + 1}: invalid format (expected email:password)`);
      continue;
    }
    const email = line.slice(0, colonIndex).trim().toLowerCase();
    const password = line.slice(colonIndex + 1).trim();
    if (!emailSchema.safeParse(email).success) {
      invalid += 1;
      errors.push(`Line ${i + 1}: invalid email`);
      continue;
    }
    if (!password) {
      invalid += 1;
      errors.push(`Line ${i + 1}: password is required`);
      continue;
    }
    const username = email.split("@")[0];
    if (!username) {
      invalid += 1;
      errors.push(`Line ${i + 1}: username could not be derived`);
      continue;
    }
    parsed.push({
      lineNumber: i + 1,
      fromEmail: email,
      username,
      password
    });
  }

  return { scanned, invalid, parsed, errors };
}

function isUnknownSmtpFieldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid `prisma.smtpAccount") && message.includes("Unknown argument");
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const parsedLines = parseInputLines(parsedBody.data.lines);
  const errors = [...parsedLines.errors];
  let added = 0;
  let updated = 0;
  let skippedDuplicate = 0;
  let invalid = parsedLines.invalid;

  const existingAccounts = await prisma.smtpAccount.findMany({
    where: { isSoftDeleted: false },
    select: { id: true, fromEmail: true }
  });
  const existingByEmail = new Map<string, { id: string; fromEmail: string }>(
    existingAccounts.map((item: any) => [String(item.fromEmail).toLowerCase(), { id: String(item.id), fromEmail: String(item.fromEmail) }])
  );
  const seenInPayload = new Set<string>();

  for (const entry of parsedLines.parsed) {
    const key = entry.fromEmail.toLowerCase();
    if (seenInPayload.has(key)) {
      skippedDuplicate += 1;
      continue;
    }
    seenInPayload.add(key);

    const fullData = {
      name: `${entry.username} Alibaba`,
      host: "smtpdm-ap-southeast-1.aliyuncs.com",
      port: 465,
      encryption: "ssl",
      username: entry.username,
      passwordEncrypted: encryptSmtpSecret(entry.password),
      fromEmail: entry.fromEmail,
      fromName: entry.username,
      providerLabel: "alibaba",
      isActive: true,
      isSoftDeleted: false,
      targetRatePerSecond: 1,
      warmupEnabled: true,
      warmupStartRps: 1,
      warmupIncrementStep: 1,
      healthStatus: "healthy",
      lastError: null
    };

    const existing = existingByEmail.get(key);
    try {
      if (existing) {
        if (!parsedBody.data.updateExisting) {
          skippedDuplicate += 1;
          continue;
        }
        try {
          await prisma.smtpAccount.update({
            where: { id: existing.id },
            data: fullData as any
          });
        } catch (error) {
          if (!isUnknownSmtpFieldError(error)) throw error;
          await prisma.smtpAccount.update({
            where: { id: existing.id },
            data: {
              name: fullData.name,
              host: fullData.host,
              port: fullData.port,
              encryption: fullData.encryption,
              username: fullData.username,
              passwordEncrypted: fullData.passwordEncrypted,
              fromEmail: fullData.fromEmail,
              fromName: fullData.fromName,
              providerLabel: fullData.providerLabel,
              isActive: true,
              isSoftDeleted: false,
              targetRatePerSecond: 1
            }
          });
        }
        updated += 1;
      } else {
        try {
          await prisma.smtpAccount.create({
            data: fullData as any
          });
        } catch (error) {
          if (!isUnknownSmtpFieldError(error)) throw error;
          await prisma.smtpAccount.create({
            data: {
              name: fullData.name,
              host: fullData.host,
              port: fullData.port,
              encryption: fullData.encryption,
              username: fullData.username,
              passwordEncrypted: fullData.passwordEncrypted,
              fromEmail: fullData.fromEmail,
              fromName: fullData.fromName,
              providerLabel: fullData.providerLabel,
              isActive: true,
              targetRatePerSecond: 1
            }
          });
        }
        added += 1;
      }
    } catch {
      invalid += 1;
      errors.push(`Line ${entry.lineNumber}: import failed`);
    }
  }

  await writeAuditLog(session.userId, "smtp.bulk_add_alibaba", "smtp_account", {
    scanned: parsedLines.scanned,
    added,
    updated,
    skippedDuplicate,
    invalid
  });

  return NextResponse.json({
    ok: true,
    scanned: parsedLines.scanned,
    added,
    updated,
    skippedDuplicate,
    invalid,
    errors
  });
}

