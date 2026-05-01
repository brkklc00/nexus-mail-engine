"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Download, FileUp, Loader2, PlusCircle, ShieldMinus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { OverlayPortal } from "@/components/ui/overlay-portal";

type ListSummary = {
  totalRecipients: number;
  validCount: number;
  invalidCount: number;
  duplicateSkippedCount: number;
  suppressedCount: number;
  lastImportDate: string | null;
  addedToday?: number;
};

type ListItem = {
  id: string;
  name: string;
  notes: string | null;
  tags: string[];
  maxSize: number;
  summary: ListSummary;
  createdAt: string;
};

type ActionState =
  | "create"
  | "update"
  | "delete"
  | "import"
  | "bulkRemove"
  | "validate"
  | "dedupe"
  | "removeInvalid"
  | "removeSuppressed"
  | "clear"
  | "exportValid"
  | "exportInvalid"
  | null;

type ActionResultSummary = {
  scanned: number;
  valid: number;
  invalid: number;
  duplicatesFound: number;
  duplicatesRemoved: number;
  suppressedFound: number;
  removed: number;
};

type ImportProgress = {
  running: boolean;
  totalBatches: number | null;
  currentBatch: number;
  totalProcessed: number;
  totalTarget: number;
  added: number;
  invalidSkipped: number;
  duplicateSkipped: number;
  alreadySuppressedSkipped: number;
  alreadyInListSkipped: number;
  alreadyInOtherListsSkipped: number;
  capacitySkipped: number;
  errors: number;
  source: "paste" | "csv" | null;
  headerDetected: boolean | null;
};

const EMPTY_SUMMARY: ListSummary = {
  totalRecipients: 0,
  validCount: 0,
  invalidCount: 0,
  duplicateSkippedCount: 0,
  suppressedCount: 0,
  lastImportDate: null
};

const EMPTY_IMPORT_PROGRESS: ImportProgress = {
  running: false,
  totalBatches: null,
  currentBatch: 0,
  totalProcessed: 0,
  totalTarget: 0,
  added: 0,
  invalidSkipped: 0,
  duplicateSkipped: 0,
  alreadySuppressedSkipped: 0,
  alreadyInListSkipped: 0,
  alreadyInOtherListsSkipped: 0,
  capacitySkipped: 0,
  errors: 0,
  source: null,
  headerDetected: null
};

const IMPORT_CHUNK_SIZE = 7500;
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

function splitTextIntoBatches(input: string, maxLines = IMPORT_CHUNK_SIZE, maxChars = 220_000): string[] {
  const normalized = input.replace(/\r/g, "");
  const rawLines = normalized.includes("\n")
    ? normalized.split("\n")
    : normalized.includes(";") || normalized.includes("\t")
      ? normalized.split(/[;\t]+/g)
      : [normalized];

  const lines = rawLines.map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const batches: string[] = [];
  let current: string[] = [];
  let charCount = 0;

  for (const line of lines) {
    const nextChars = charCount + line.length + 1;
    if (current.length >= maxLines || nextChars > maxChars) {
      batches.push(current.join("\n"));
      current = [];
      charCount = 0;
    }
    current.push(line);
    charCount += line.length + 1;
  }
  if (current.length > 0) batches.push(current.join("\n"));
  return batches;
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
  if (!matches || matches.length === 0) return [];
  return matches.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

async function* streamFileLines(file: File): AsyncGenerator<string> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      yield line;
    }
  }

  buffer += decoder.decode();
  if (buffer.length > 0) {
    yield buffer;
  }
}

async function analyzeCsvCandidates(file: File): Promise<{ totalCandidates: number; headerDetected: boolean }> {
  let headerResolved = false;
  let headerDetected = false;
  let delimiter: "," | ";" | "\t" | null = null;
  let emailColumnIndex = -1;
  let totalCandidates = 0;

  for await (const rawLine of streamFileLines(file)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!headerResolved) {
      const detected = detectDelimiter(line);
      if (detected) {
        const headers = splitCsvRow(line, detected).map((cell) => normalizeHeaderLabel(cell));
        const foundIndex = headers.findIndex((header) => emailHeaderAliases.has(header));
        if (foundIndex >= 0) {
          headerDetected = true;
          delimiter = detected;
          emailColumnIndex = foundIndex;
          headerResolved = true;
          continue;
        }
      }
      headerResolved = true;
    }

    const tokens = headerDetected && delimiter
      ? extractEmailsFromToken(splitCsvRow(line, delimiter)[emailColumnIndex] ?? "")
      : extractEmailsFromToken(line);
    totalCandidates += tokens.length;
  }

  return { totalCandidates, headerDetected };
}

async function* streamCsvEmailChunks(
  file: File,
  chunkSize: number
): AsyncGenerator<{ emails: string[]; headerDetected: boolean }> {
  let headerResolved = false;
  let headerDetected = false;
  let delimiter: "," | ";" | "\t" | null = null;
  let emailColumnIndex = -1;
  let chunk: string[] = [];

  for await (const rawLine of streamFileLines(file)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!headerResolved) {
      const detected = detectDelimiter(line);
      if (detected) {
        const headers = splitCsvRow(line, detected).map((cell) => normalizeHeaderLabel(cell));
        const foundIndex = headers.findIndex((header) => emailHeaderAliases.has(header));
        if (foundIndex >= 0) {
          headerDetected = true;
          delimiter = detected;
          emailColumnIndex = foundIndex;
          headerResolved = true;
          continue;
        }
      }
      headerResolved = true;
    }

    const emails = headerDetected && delimiter
      ? extractEmailsFromToken(splitCsvRow(line, delimiter)[emailColumnIndex] ?? "")
      : extractEmailsFromToken(line);

    for (const email of emails) {
      chunk.push(email);
      if (chunk.length >= chunkSize) {
        yield { emails: chunk, headerDetected };
        chunk = [];
      }
    }
  }

  if (chunk.length > 0) {
    yield { emails: chunk, headerDetected };
  }
}

function formatActionSummary(result: ActionResultSummary): string {
  return `scanned ${result.scanned}, valid ${result.valid}, invalid ${result.invalid}, duplicatesFound ${result.duplicatesFound}, duplicatesRemoved ${result.duplicatesRemoved}, suppressedFound ${result.suppressedFound}, removed ${result.removed}`;
}

export function ListsManager({ initialLists }: { initialLists: ListItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [lists, setLists] = useState(initialLists);
  const [selectedId, setSelectedId] = useState(initialLists[0]?.id ?? "");
  const [selectedSummary, setSelectedSummary] = useState<ListSummary>(initialLists[0]?.summary ?? EMPTY_SUMMARY);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress>(EMPTY_IMPORT_PROGRESS);
  const [lastActionSummary, setLastActionSummary] = useState<ActionResultSummary | null>(null);
  const [resultModal, setResultModal] = useState<{ title: string; body: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);

  const [listForm, setListForm] = useState({
    name: "",
    notes: "",
    tags: "",
    capacityLimit: ""
  });
  const [importForm, setImportForm] = useState({
    text: "",
    dedupeGlobally: false
  });
  const [selectedCsvFile, setSelectedCsvFile] = useState<File | null>(null);
  const [removeForm, setRemoveForm] = useState({
    text: "",
    removeFromAllLists: false,
    addToSuppression: false
  });

  const selected = useMemo(() => lists.find((item) => item.id === selectedId) ?? null, [lists, selectedId]);

  async function sendImportChunk(
    listId: string,
    payload: { text?: string; emails?: string[] },
    dedupeGlobally: boolean
  ) {
    const response = await fetch(`/api/lists/${listId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        dedupeGlobally
      })
    });

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      result?: {
        totalProcessed: number;
        added: number;
        duplicateSkipped: number;
        invalidSkipped: number;
        alreadySuppressedSkipped: number;
        alreadyInListSkipped: number;
        alreadyInOtherListsSkipped: number;
        capacitySkipped: number;
      };
    };

    if (!response.ok || !body.ok || !body.result) {
      throw new Error(body.error ?? "Data could not be processed.");
    }
    return body.result;
  }

  async function fetchListSummary(id: string) {
    const response = await fetch(`/api/lists/${id}`);
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      list?: { summary: ListSummary };
    };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("List summary could not be loaded", payload.error ?? "Operation failed");
      return null;
    }
    return payload.list.summary;
  }

  async function selectList(id: string) {
    setSelectedId(id);
    const summary = await fetchListSummary(id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === id ? { ...item, summary } : item)));
    }
  }

  async function createList() {
    setActionState("create");
    const response = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: listForm.name,
        notes: listForm.notes || undefined,
        tags: listForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        maxSize: listForm.capacityLimit ? Number(listForm.capacityLimit) : undefined
      })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      list?: { id: string; name: string; notes: string | null; tags: string[]; maxSize: number; createdAt: string };
    };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("List could not be created", payload.error ?? "Operation failed");
      setActionState(null);
      return;
    }

    const nextList: ListItem = {
      id: payload.list.id,
      name: payload.list.name,
      notes: payload.list.notes,
      tags: payload.list.tags ?? [],
      maxSize: payload.list.maxSize,
      summary: EMPTY_SUMMARY,
      createdAt: payload.list.createdAt
    };
    setLists((prev) => [nextList, ...prev]);
    setListForm({ name: "", notes: "", tags: "", capacityLimit: "" });
    setCreateOpen(false);
    toast.success("List created");
    setActionState(null);
    await selectList(nextList.id);
    router.refresh();
  }

  async function updateList(override?: { name?: string; notes?: string | null; tags?: string[]; maxSize?: number }) {
    if (!selected) return;
    const requestBody = {
      name: override?.name ?? selected.name,
      notes: override?.notes ?? selected.notes,
      tags: override?.tags ?? selected.tags,
      maxSize: override?.maxSize ?? selected.maxSize
    };
    setActionState("update");
    const response = await fetch(`/api/lists/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: requestBody.name,
        notes: requestBody.notes,
        tags: requestBody.tags,
        maxSize: requestBody.maxSize
      })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      list?: { name: string; notes: string | null; tags: string[]; maxSize: number };
    };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("List could not be updated", payload.error ?? "Operation failed");
      setActionState(null);
      return;
    }
    setLists((prev) =>
      prev.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              name: payload.list!.name,
              notes: payload.list!.notes,
              tags: payload.list!.tags,
              maxSize: payload.list!.maxSize
            }
          : item
      )
    );
    setEditOpen(false);
    toast.success("List updated");
    setActionState(null);
    router.refresh();
  }

  async function deleteList() {
    if (!selected) return;
    const accepted = await confirm({
      title: "Delete this list?",
      message: `The "${selected.name}" list and its memberships will be removed.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "danger"
    });
    if (!accepted) return;

    setActionState("delete");
    const response = await fetch(`/api/lists/${selected.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("List could not be deleted", payload.error ?? "Operation failed");
      setActionState(null);
      return;
    }

    const next = lists.filter((item) => item.id !== selected.id);
    setLists(next);
    setSelectedId(next[0]?.id ?? "");
    setSelectedSummary(next[0]?.summary ?? EMPTY_SUMMARY);
    setActionState(null);
    toast.success("List deleted");
    router.refresh();
  }

  async function importBulk() {
    if (!selected) return;
    const hasText = Boolean(importForm.text.trim());
    const hasCsv = Boolean(selectedCsvFile);
    if (!hasText && !hasCsv) return;

    setActionState("import");

    try {
      if (selectedCsvFile) {
        const analysis = await analyzeCsvCandidates(selectedCsvFile);
        let aggregate: ImportProgress = {
          ...EMPTY_IMPORT_PROGRESS,
          running: true,
          source: "csv",
          totalTarget: analysis.totalCandidates,
          headerDetected: analysis.headerDetected
        };
        setImportProgress(aggregate);

        for await (const chunkPayload of streamCsvEmailChunks(selectedCsvFile, IMPORT_CHUNK_SIZE)) {
          const result = await sendImportChunk(
            selected.id,
            { emails: chunkPayload.emails },
            importForm.dedupeGlobally
          );
          aggregate = {
            ...aggregate,
            currentBatch: aggregate.currentBatch + 1,
            totalProcessed: aggregate.totalProcessed + result.totalProcessed,
            added: aggregate.added + result.added,
            invalidSkipped: aggregate.invalidSkipped + result.invalidSkipped,
            duplicateSkipped: aggregate.duplicateSkipped + result.duplicateSkipped,
            alreadySuppressedSkipped: aggregate.alreadySuppressedSkipped + result.alreadySuppressedSkipped,
            alreadyInListSkipped: aggregate.alreadyInListSkipped + result.alreadyInListSkipped,
            alreadyInOtherListsSkipped: aggregate.alreadyInOtherListsSkipped + result.alreadyInOtherListsSkipped,
            capacitySkipped: aggregate.capacitySkipped + result.capacitySkipped,
            headerDetected: chunkPayload.headerDetected
          };
          setImportProgress(aggregate);
        }

        setSelectedCsvFile(null);
        toast.success(
          "CSV import completed",
          `Scanned ${aggregate.totalProcessed}, imported ${aggregate.added}, invalid ${aggregate.invalidSkipped}, duplicate ${aggregate.duplicateSkipped}, suppressed ${aggregate.alreadySuppressedSkipped}, global duplicate ${aggregate.alreadyInOtherListsSkipped}`
        );
        setResultModal({
          title: "Import result",
          body: `Total scanned: ${aggregate.totalProcessed}\nValid imported: ${aggregate.added}\nInvalid skipped: ${aggregate.invalidSkipped}\nDuplicate skipped: ${aggregate.duplicateSkipped}\nSuppressed skipped: ${aggregate.alreadySuppressedSkipped}\nGlobal duplicate skipped: ${aggregate.alreadyInOtherListsSkipped}\nCapacity skipped: ${aggregate.capacitySkipped}\nErrors: ${aggregate.errors}`
        });
      } else {
        const batches = splitTextIntoBatches(importForm.text, IMPORT_CHUNK_SIZE, 220_000);
        if (batches.length === 0) {
          toast.warning("No valid input found for import");
          setActionState(null);
          return;
        }

        let aggregate: ImportProgress = {
          ...EMPTY_IMPORT_PROGRESS,
          running: true,
          source: "paste",
          totalBatches: batches.length
        };
        setImportProgress(aggregate);

        for (let i = 0; i < batches.length; i += 1) {
          const result = await sendImportChunk(
            selected.id,
            { text: batches[i] },
            importForm.dedupeGlobally
          );
          aggregate = {
            ...aggregate,
            currentBatch: i + 1,
            totalProcessed: aggregate.totalProcessed + result.totalProcessed,
            added: aggregate.added + result.added,
            invalidSkipped: aggregate.invalidSkipped + result.invalidSkipped,
            duplicateSkipped: aggregate.duplicateSkipped + result.duplicateSkipped,
            alreadySuppressedSkipped: aggregate.alreadySuppressedSkipped + result.alreadySuppressedSkipped,
            alreadyInListSkipped: aggregate.alreadyInListSkipped + result.alreadyInListSkipped,
            alreadyInOtherListsSkipped: aggregate.alreadyInOtherListsSkipped + result.alreadyInOtherListsSkipped,
            capacitySkipped: aggregate.capacitySkipped + result.capacitySkipped
          };
          setImportProgress(aggregate);
        }

        setImportForm((prev) => ({ ...prev, text: "" }));
        toast.success(
          "Import completed",
          `Scanned ${aggregate.totalProcessed}, imported ${aggregate.added}, invalid ${aggregate.invalidSkipped}, duplicate ${aggregate.duplicateSkipped}, suppressed ${aggregate.alreadySuppressedSkipped}, global duplicate ${aggregate.alreadyInOtherListsSkipped}`
        );
        setResultModal({
          title: "Import result",
          body: `Total scanned: ${aggregate.totalProcessed}\nValid imported: ${aggregate.added}\nInvalid skipped: ${aggregate.invalidSkipped}\nDuplicate skipped: ${aggregate.duplicateSkipped}\nSuppressed skipped: ${aggregate.alreadySuppressedSkipped}\nGlobal duplicate skipped: ${aggregate.alreadyInOtherListsSkipped}\nCapacity skipped: ${aggregate.capacitySkipped}\nErrors: ${aggregate.errors}`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Data could not be processed.";
      setImportProgress((prev) => ({
        ...prev,
        running: false,
        errors: prev.errors + 1
      }));
      toast.error("Import failed", message);
      setActionState(null);
      return;
    }

    const summary = await fetchListSummary(selected.id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, summary } : item)));
    }
    setImportProgress((prev) => ({ ...prev, running: false }));
    setActionState(null);
    router.refresh();
  }

  async function bulkRemove() {
    if (!selected || !removeForm.text.trim()) return;
    const accepted = await confirm({
      title: "Run bulk remove?",
      message: removeForm.removeFromAllLists
        ? "Emails will be removed from all lists."
        : "Emails will be removed only from the selected list.",
      confirmLabel: "Apply",
      cancelLabel: "Cancel",
      tone: "warning"
    });
    if (!accepted) return;

    setActionState("bulkRemove");
    const response = await fetch(`/api/lists/${selected.id}/bulk-remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(removeForm)
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      result?: {
        totalProcessed: number;
        recipientMatches: number;
        removedMemberships: number;
        suppressionAdded: number;
      };
    };
    if (!response.ok || !payload.ok || !payload.result) {
      toast.error("Bulk remove failed", payload.error ?? "Operation failed");
      setActionState(null);
      return;
    }
    setRemoveForm((prev) => ({ ...prev, text: "" }));
    toast.info(
      "Bulk remove completed",
      `Processed ${payload.result.totalProcessed}, removed memberships ${payload.result.removedMemberships}, suppression added ${payload.result.suppressionAdded}`
    );
    setResultModal({
      title: "Bulk remove result",
      body: `Processed: ${payload.result.totalProcessed}\nRemoved memberships: ${payload.result.removedMemberships}\nSuppression added: ${payload.result.suppressionAdded}`
    });
    const summary = await fetchListSummary(selected.id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, summary } : item)));
    }
    setActionState(null);
    router.refresh();
  }

  async function runListAction(
    action: "validate" | "dedupe" | "remove_invalid" | "remove_suppressed" | "clear",
    state: ActionState,
    title: string,
    message: string,
    tone: "warning" | "danger" = "warning"
  ) {
    if (!selected) return;
    const accepted = await confirm({
      title,
      message,
      confirmLabel: "Apply",
      cancelLabel: "Cancel",
      tone
    });
    if (!accepted) return;

    setActionState(state);
    const response = await fetch(`/api/lists/${selected.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      result?: ActionResultSummary;
    };
    if (!response.ok || !payload.ok) {
      toast.error("List action failed", payload.error ?? "Operation failed");
      setActionState(null);
      return;
    }
    const result = payload.result ?? {
      scanned: 0,
      valid: 0,
      invalid: 0,
      duplicatesFound: 0,
      duplicatesRemoved: 0,
      suppressedFound: 0,
      removed: 0
    };
    setLastActionSummary(result);
    toast.success("List action completed", formatActionSummary(result));
    setResultModal({
      title: "Validation tool result",
      body: formatActionSummary(result)
    });
    const summary = await fetchListSummary(selected.id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, summary } : item)));
    }
    setActionState(null);
    router.refresh();
  }

  async function exportCsv(status: "valid" | "invalid") {
    if (!selected) return;
    setActionState(status === "valid" ? "exportValid" : "exportInvalid");
    const response = await fetch(`/api/lists/${selected.id}/export?status=${status}`);
    if (!response.ok) {
      toast.error("Export failed");
      setActionState(null);
      return;
    }
    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `list-${selected.id}-${status}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`CSV export completed (${status})`);
    setActionState(null);
  }

  async function importCsvFile(file: File) {
    setSelectedCsvFile(file);
    toast.info("CSV file selected", `${file.name} will be imported in scalable chunks.`);
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-200">List Library</h3>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-zinc-200"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            New
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {lists.length === 0 ? (
            <p className="text-xs text-zinc-500">No lists yet.</p>
          ) : (
            lists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => void selectList(list.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  selectedId === list.id ? "border-indigo-400/40 bg-indigo-500/10" : "border-border bg-zinc-900/40"
                }`}
              >
                <p className="text-sm font-medium text-white">{list.name}</p>
                <p className="text-xs text-zinc-400">
                  {list.summary.totalRecipients.toLocaleString()} recipients · cap {list.maxSize.toLocaleString()}
                </p>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <input
                  className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-white"
                  value={selected.name}
                  onChange={(e) =>
                    setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, name: e.target.value } : item)))
                  }
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Last import: {selectedSummary.lastImportDate ? new Date(selectedSummary.lastImportDate).toLocaleString() : "Never"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setListForm({
                      name: selected.name,
                      notes: selected.notes ?? "",
                      tags: selected.tags.join(", "),
                      capacityLimit: `${selected.maxSize}`
                    });
                    setEditOpen(true);
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200"
                >
                  Edit list
                </button>
                <button
                  type="button"
                  onClick={() => void updateList()}
                  disabled={actionState !== null}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
                >
                  {actionState === "update" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null} Update
                </button>
                <button
                  type="button"
                  onClick={() => void deleteList()}
                  disabled={actionState !== null}
                  className="rounded-lg border border-rose-400/40 px-3 py-2 text-xs text-rose-300 disabled:opacity-60"
                >
                  {actionState === "delete" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : <Trash2 className="inline h-3.5 w-3.5" />} Delete
                </button>
                <button
                  type="button"
                  onClick={() => setBulkRemoveOpen(true)}
                  className="rounded-lg border border-amber-400/40 px-3 py-2 text-xs text-amber-200"
                >
                  Bulk Remove
                </button>
                <button
                  type="button"
                  onClick={() => setValidationOpen(true)}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200"
                >
                  Validation Tools
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="flex min-w-max gap-2">
                <Stat label="Total" value={selectedSummary.totalRecipients} />
                <Stat label="Valid" value={selectedSummary.validCount} />
                <Stat label="Invalid" value={selectedSummary.invalidCount} />
                <Stat label="Suppressed" value={selectedSummary.suppressedCount} />
                <Stat label="Dup skipped" value={selectedSummary.duplicateSkippedCount} />
                <Stat label="Added today" value={selectedSummary.addedToday ?? 0} />
                <Stat label="Capacity limit" value={selected.maxSize} />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Bulk Paste Import</p>
              <p className="mt-1 text-xs text-zinc-500">
                Paste one email per line or mixed text; system will extract valid emails.
              </p>
              <p className="mt-1 text-xs text-amber-300">
                For 100k+ recipients, use CSV upload. Imports are processed in chunks.
              </p>
              <textarea
                rows={6}
                value={importForm.text}
                onChange={(e) => setImportForm((s) => ({ ...s, text: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                placeholder={"john@acme.com\nJane Doe <jane@acme.com>\nfoo@bar.com; bar@foo.com"}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-300">
                  <FileUp className="h-3.5 w-3.5" />
                  Upload CSV
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="hidden"
                    disabled={actionState === "import"}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void importCsvFile(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={importForm.dedupeGlobally}
                    onChange={(e) => setImportForm((s) => ({ ...s, dedupeGlobally: e.target.checked }))}
                  />
                  Dedupe globally
                </label>
                <button
                  type="button"
                  onClick={() => void importBulk()}
                  disabled={actionState !== null || (!importForm.text.trim() && !selectedCsvFile)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-60"
                >
                  {actionState === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Import
                </button>
                {selectedCsvFile ? (
                  <button
                    type="button"
                    onClick={() => setSelectedCsvFile(null)}
                    disabled={actionState === "import"}
                    className="inline-flex items-center rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-400 disabled:opacity-60"
                  >
                    Clear file
                  </button>
                ) : null}
              </div>
              {selectedCsvFile ? (
                <p className="mt-2 text-xs text-zinc-400">
                  Selected file: {selectedCsvFile.name} ({Math.ceil(selectedCsvFile.size / 1024).toLocaleString()} KB)
                </p>
              ) : null}
              {importProgress.running || importProgress.currentBatch > 0 ? (
                <div className="mt-3 rounded-lg border border-border bg-zinc-900/70 p-2 text-xs text-zinc-300">
                  <p>
                    Source: {importProgress.source ?? "-"} · Batch{" "}
                    {importProgress.currentBatch}/{importProgress.totalBatches ?? "-"} · Imported/Total{" "}
                    {importProgress.added.toLocaleString()} / {(importProgress.totalTarget || importProgress.totalProcessed).toLocaleString()}
                  </p>
                  <p className="text-zinc-500">
                    scanned {importProgress.totalProcessed.toLocaleString()} · valid {(importProgress.totalProcessed - importProgress.invalidSkipped).toLocaleString()} · invalid{" "}
                    {importProgress.invalidSkipped.toLocaleString()} · duplicate {importProgress.duplicateSkipped.toLocaleString()} · suppressed{" "}
                    {importProgress.alreadySuppressedSkipped.toLocaleString()} · global duplicate {importProgress.alreadyInOtherListsSkipped.toLocaleString()} · errors{" "}
                    {importProgress.errors.toLocaleString()}
                  </p>
                  {importProgress.headerDetected !== null ? (
                    <p className="text-zinc-500">
                      CSV header detection: {importProgress.headerDetected ? "detected email column" : "not detected (fallback regex mode)"}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {lastActionSummary ? (
              <div className="rounded-xl border border-border bg-zinc-900/60 p-3 text-xs text-zinc-300">
                <p>Last validation result:</p>
                <p>
                  scanned {lastActionSummary.scanned.toLocaleString()} · valid {lastActionSummary.valid.toLocaleString()} · invalid{" "}
                  {lastActionSummary.invalid.toLocaleString()} · removed {lastActionSummary.removed.toLocaleString()}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState icon="folder-plus" title="Select a list" description="Pick a list from the left to use dashboard and tools." />
        )}
      </section>

      <ModalShell open={createOpen} title="Create List" onClose={() => setCreateOpen(false)}>
        <ListForm listForm={listForm} setListForm={setListForm} />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void createList()}
            disabled={actionState !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            {actionState === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            Add list
          </button>
        </div>
      </ModalShell>

      <ModalShell open={editOpen} title="Edit List" onClose={() => setEditOpen(false)}>
        <ListForm listForm={listForm} setListForm={setListForm} />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={async () => {
              if (!selected) return;
              const tags = listForm.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean);
              await updateList({
                name: listForm.name,
                notes: listForm.notes || null,
                tags,
                maxSize: listForm.capacityLimit ? Number(listForm.capacityLimit) : selected.maxSize
              });
            }}
            disabled={actionState !== null}
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </ModalShell>

      <ModalShell open={Boolean(resultModal)} title={resultModal?.title ?? "Result"} onClose={() => setResultModal(null)}>
        <pre className="whitespace-pre-wrap rounded-lg border border-border bg-zinc-900/60 p-3 text-xs text-zinc-200">
          {resultModal?.body}
        </pre>
      </ModalShell>

      <ModalShell open={bulkRemoveOpen} title="Bulk Remove" onClose={() => setBulkRemoveOpen(false)}>
        <textarea
          rows={6}
          value={removeForm.text}
          onChange={(e) => setRemoveForm((s) => ({ ...s, text: e.target.value }))}
          className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          placeholder={"remove@domain.com\nremove2@domain.com"}
        />
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={removeForm.removeFromAllLists}
              onChange={(e) => setRemoveForm((s) => ({ ...s, removeFromAllLists: e.target.checked }))}
            />
            Remove from all lists
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={removeForm.addToSuppression}
              onChange={(e) => setRemoveForm((s) => ({ ...s, addToSuppression: e.target.checked }))}
            />
            Add to suppression while removing
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={async () => {
              await bulkRemove();
              setBulkRemoveOpen(false);
            }}
            disabled={actionState !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-60"
          >
            {actionState === "bulkRemove" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldMinus className="h-4 w-4" />}
            Run bulk remove
          </button>
        </div>
      </ModalShell>

      <ModalShell open={validationOpen} title="Validation Tools" onClose={() => setValidationOpen(false)}>
        <div className="flex flex-wrap gap-2">
          <ActionBtn
            label="Validate list"
            loading={actionState === "validate"}
            onClick={() => void runListAction("validate", "validate", "Validate this list?", "Invalid emails will be marked as invalid.")}
          />
          <ActionBtn
            label="Deduplicate list"
            loading={actionState === "dedupe"}
            onClick={() => void runListAction("dedupe", "dedupe", "Run deduplication?", "Duplicate membership rows will be removed.")}
          />
          <ActionBtn
            label="Remove invalid emails"
            loading={actionState === "removeInvalid"}
            onClick={() => void runListAction("remove_invalid", "removeInvalid", "Remove invalid records?", "Membership rows with invalid status will be removed.")}
          />
          <ActionBtn
            label="Remove suppressed emails"
            loading={actionState === "removeSuppressed"}
            onClick={() =>
              void runListAction("remove_suppressed", "removeSuppressed", "Remove suppressed records?", "Memberships matching global/list suppression will be removed.")
            }
          />
          <ActionBtn
            label="Clear selected list"
            loading={actionState === "clear"}
            danger
            onClick={() =>
              void runListAction("clear", "clear", "Clear this list completely?", "All memberships in the selected list will be removed.", "danger")
            }
          />
          <ActionBtn
            label="Export valid emails"
            loading={actionState === "exportValid"}
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => void exportCsv("valid")}
          />
          <ActionBtn
            label="Export invalid emails"
            loading={actionState === "exportInvalid"}
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => void exportCsv("invalid")}
          />
        </div>
      </ModalShell>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[150px] rounded-lg border border-border bg-zinc-900/70 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{value.toLocaleString()}</p>
    </div>
  );
}

function ActionBtn({
  label,
  loading,
  onClick,
  icon,
  danger = false
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs ${
        danger ? "border-rose-400/40 text-rose-300" : "border-border text-zinc-200"
      } disabled:opacity-60`}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function ListForm({
  listForm,
  setListForm
}: {
  listForm: { name: string; notes: string; tags: string; capacityLimit: string };
  setListForm: (updater: (prev: { name: string; notes: string; tags: string; capacityLimit: string }) => { name: string; notes: string; tags: string; capacityLimit: string }) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100"
        placeholder="List name"
        value={listForm.name}
        onChange={(e) => setListForm((s) => ({ ...s, name: e.target.value }))}
      />
      <textarea
        className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100"
        placeholder="Description (optional)"
        rows={3}
        value={listForm.notes}
        onChange={(e) => setListForm((s) => ({ ...s, notes: e.target.value }))}
      />
      <input
        className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100"
        placeholder="Tags (comma separated)"
        value={listForm.tags}
        onChange={(e) => setListForm((s) => ({ ...s, tags: e.target.value }))}
      />
      <input
        className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100"
        placeholder="Capacity limit (max recipients)"
        type="number"
        value={listForm.capacityLimit}
        onChange={(e) => setListForm((s) => ({ ...s, capacityLimit: e.target.value }))}
      />
    </div>
  );
}

function ModalShell({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <OverlayPortal active={open} lockScroll>
      <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
        <div className="relative z-[60] mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{title}</p>
            <button type="button" onClick={onClose} className="rounded border border-border px-2 py-1 text-xs text-zinc-300">
              Close
            </button>
          </div>
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}
