export type ImportMode = "append" | "replace" | "insert_only";

export type RecipientImportRow = {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
};

export type CleanOptions = {
  skipSuppressed?: boolean;
  roleEmailBlocking?: boolean;
  mode: ImportMode;
  suppressedEmails?: Set<string>;
  existingByEmail?: Map<string, RecipientImportRow>;
};

export type CleanSummary = {
  imported: number;
  updated: number;
  skipped: number;
  invalid: number;
  duplicate: number;
};

export type CleanResult = {
  cleanRows: RecipientImportRow[];
  summary: CleanSummary;
};

const ROLE_PREFIXES = new Set(["admin", "info", "support", "contact", "hello", "team"]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmailSyntaxValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isRoleBasedEmail(email: string): boolean {
  const localPart = email.split("@")[0] ?? "";
  return ROLE_PREFIXES.has(localPart);
}

export function cleanImportRows(rows: RecipientImportRow[], options: CleanOptions): CleanResult {
  const summary: CleanSummary = {
    imported: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    duplicate: 0
  };

  const seen = new Set<string>();
  const cleanRows: RecipientImportRow[] = [];

  for (const row of rows) {
    const normalized = normalizeEmail(row.email);

    if (!isEmailSyntaxValid(normalized)) {
      summary.invalid += 1;
      continue;
    }

    if (options.roleEmailBlocking && isRoleBasedEmail(normalized)) {
      summary.skipped += 1;
      continue;
    }

    if (options.skipSuppressed && options.suppressedEmails?.has(normalized)) {
      summary.skipped += 1;
      continue;
    }

    if (seen.has(normalized)) {
      summary.duplicate += 1;
      continue;
    }
    seen.add(normalized);

    const existing = options.existingByEmail?.get(normalized);
    if (!existing) {
      cleanRows.push({ ...row, email: normalized });
      summary.imported += 1;
      continue;
    }

    if (options.mode === "insert_only") {
      summary.skipped += 1;
      continue;
    }

    const merged: RecipientImportRow =
      options.mode === "replace"
        ? { ...row, email: normalized }
        : {
            ...existing,
            ...row,
            email: normalized,
            customFields: {
              ...(existing.customFields ?? {}),
              ...(row.customFields ?? {})
            },
            tags: Array.from(new Set([...(existing.tags ?? []), ...(row.tags ?? [])]))
          };

    cleanRows.push(merged);
    summary.updated += 1;
  }

  return { cleanRows, summary };
}
