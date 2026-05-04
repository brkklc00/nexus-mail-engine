import { z } from "zod";

const emailSchema = z.string().email();

export type BulkAlibabaParsedEntry = {
  lineNumber: number;
  /** Full verified sender address (SMTP username for Alibaba DirectMail) */
  email: string;
  username: string;
  fromEmail: string;
  /** Local-part only (before @) */
  fromName: string;
  password: string;
};

export type BulkAlibabaPreviewRow = {
  lineNumber: number;
  email: string;
  username: string;
  fromEmail: string;
  status: "ok" | "invalid" | "duplicate";
};

function splitEmailPasswordLine(line: string): { email: string; password: string } | null {
  const colonIndex = line.indexOf(":");
  if (colonIndex <= 0) return null;
  const email = line.slice(0, colonIndex).trim();
  const password = line.slice(colonIndex + 1).trim();
  return { email, password };
}

/**
 * Split only on first colon; trim email/password; password may contain ":" — preserved after first colon before trim.
 */
export function parseBulkAlibabaLines(raw: string): {
  scanned: number;
  invalid: number;
  parsed: BulkAlibabaParsedEntry[];
  errors: string[];
} {
  const lines = raw.replace(/\r/g, "").split("\n");
  const parsed: BulkAlibabaParsedEntry[] = [];
  const errors: string[] = [];
  let scanned = 0;
  let invalid = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    scanned += 1;
    const parts = splitEmailPasswordLine(line);
    if (!parts) {
      invalid += 1;
      errors.push(`Line ${i + 1}: invalid format (expected email:password)`);
      continue;
    }
    const { email, password } = parts;
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
    const at = email.indexOf("@");
    const local = at > 0 ? email.slice(0, at) : "";
    if (!local) {
      invalid += 1;
      errors.push(`Line ${i + 1}: invalid email`);
      continue;
    }

    parsed.push({
      lineNumber: i + 1,
      email,
      username: email,
      fromEmail: email,
      fromName: local,
      password
    });
  }

  return { scanned, invalid, parsed, errors };
}

/**
 * Safe preview rows for the bulk modal (no passwords). Duplicate = later non-empty line with same email (case-insensitive).
 */
export function getBulkAlibabaPreviewRows(raw: string): {
  rows: BulkAlibabaPreviewRow[];
  summary: { valid: number; invalid: number; duplicate: number };
} {
  const lines = raw.replace(/\r/g, "").split("\n");
  const rows: BulkAlibabaPreviewRow[] = [];
  const seen = new Set<string>();
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = splitEmailPasswordLine(line);
    if (!parts) {
      rows.push({
        lineNumber: i + 1,
        email: "—",
        username: "—",
        fromEmail: "—",
        status: "invalid"
      });
      invalid += 1;
      continue;
    }
    const { email, password } = parts;
    if (!emailSchema.safeParse(email).success || !password) {
      rows.push({
        lineNumber: i + 1,
        email: email || "—",
        username: email || "—",
        fromEmail: email || "—",
        status: "invalid"
      });
      invalid += 1;
      continue;
    }

    const key = email.toLowerCase();
    if (seen.has(key)) {
      rows.push({
        lineNumber: i + 1,
        email,
        username: email,
        fromEmail: email,
        status: "duplicate"
      });
      duplicate += 1;
      continue;
    }
    seen.add(key);
    rows.push({
      lineNumber: i + 1,
      email,
      username: email,
      fromEmail: email,
      status: "ok"
    });
    valid += 1;
  }

  return { rows, summary: { valid, invalid, duplicate } };
}
