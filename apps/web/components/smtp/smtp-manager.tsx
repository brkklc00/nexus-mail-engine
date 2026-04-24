"use client";

import { useState } from "react";
import { PlusCircle, PlugZap, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type Account = {
  id: string;
  name: string;
  host: string;
  port: number;
  encryption: string;
  username: string;
  fromEmail: string;
  fromName: string | null;
  providerLabel: string | null;
  isActive: boolean;
  isThrottled: boolean;
};

export function SmtpManager({ initialAccounts }: { initialAccounts: Account[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 587,
    encryption: "tls",
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
    providerLabel: ""
  });
  const [editing, setEditing] = useState<null | {
    id: string;
    name: string;
    host: string;
    port: number;
    fromEmail: string;
  }>(null);

  async function createAccount() {
    const response = await fetch("/api/smtp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      toast.error("SMTP oluşturulamadı", payload.error ?? "Alanları kontrol edin.");
      return;
    }
    setAccounts((prev) => [payload.account!, ...prev]);
    toast.success("SMTP hesabı oluşturuldu");
    setForm({
      name: "",
      host: "",
      port: 587,
      encryption: "tls",
      username: "",
      password: "",
      fromEmail: "",
      fromName: "",
      providerLabel: ""
    });
    router.refresh();
  }

  async function toggleAccount(account: Account) {
    if (account.isActive) {
      const accepted = await confirm({
        title: "SMTP hesabı pasifleştirilsin mi?",
        message: `"${account.name}" yeni kampanyalarda kullanılmayacak.`,
        confirmLabel: "Pasifleştir",
        cancelLabel: "Vazgeç",
        tone: "warning"
      });
      if (!accepted) return;
    }
    const response = await fetch(`/api/smtp/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !account.isActive })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      toast.error("SMTP güncellenemedi", payload.error ?? "İşlem başarısız.");
      return;
    }
    setAccounts((prev) => prev.map((item) => (item.id === account.id ? payload.account! : item)));
    toast.info(payload.account.isActive ? "SMTP aktif edildi" : "SMTP pasif edildi");
    router.refresh();
  }

  async function testConnection(account: Account) {
    const response = await fetch(`/api/smtp/${account.id}/test-connection`, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (response.ok && payload.ok) {
      toast.success("SMTP bağlantısı başarılı");
      return;
    }
    toast.error("SMTP bağlantı testi başarısız", payload.error ?? "Bağlantı kurulamadı.");
  }

  async function editAccount(account: Account) {
    setEditing({
      id: account.id,
      name: account.name,
      host: account.host,
      port: account.port,
      fromEmail: account.fromEmail
    });
  }

  async function submitEdit() {
    if (!editing) return;
    const response = await fetch(`/api/smtp/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        host: editing.host,
        port: editing.port,
        fromEmail: editing.fromEmail
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      toast.error("SMTP düzenleme başarısız", payload.error ?? "İşlem başarısız.");
      return;
    }
    setAccounts((prev) => prev.map((item) => (item.id === editing.id ? payload.account! : item)));
    setEditing(null);
    toast.success("SMTP güncellendi");
    router.refresh();
  }

  async function removeAccount(account: Account) {
    const accepted = await confirm({
      title: "SMTP hesabı silinsin mi?",
      message: `"${account.name}" soft-delete olarak pasiflenecek.`,
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      tone: "danger"
    });
    if (!accepted) return;
    const response = await fetch(`/api/smtp/${account.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("SMTP silinemedi", payload.error ?? "İşlem başarısız.");
      return;
    }
    setAccounts((prev) => prev.filter((item) => item.id !== account.id));
    toast.success("SMTP silindi");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-zinc-200">Add SMTP</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" placeholder="Name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" placeholder="Host" value={form.host} onChange={(e) => setForm((s) => ({ ...s, host: e.target.value }))} />
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" placeholder="Port" type="number" value={form.port} onChange={(e) => setForm((s) => ({ ...s, port: Number(e.target.value) || 587 }))} />
          <select className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" value={form.encryption} onChange={(e) => setForm((s) => ({ ...s, encryption: e.target.value }))}>
            <option value="tls">TLS</option>
            <option value="ssl">SSL</option>
            <option value="none">None</option>
          </select>
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" placeholder="Username" value={form.username} onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))} />
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" placeholder="Password" type="password" value={form.password} onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} />
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" placeholder="From email" value={form.fromEmail} onChange={(e) => setForm((s) => ({ ...s, fromEmail: e.target.value }))} />
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" placeholder="From name" value={form.fromName} onChange={(e) => setForm((s) => ({ ...s, fromName: e.target.value }))} />
          <input className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm md:col-span-2" placeholder="Provider label (optional)" value={form.providerLabel} onChange={(e) => setForm((s) => ({ ...s, providerLabel: e.target.value }))} />
        </div>
        <button type="button" onClick={() => void createAccount()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white">
          <PlusCircle className="h-4 w-4" />
          Save SMTP
        </button>
      </div>
      {editing ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-zinc-200">Edit SMTP</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <input
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              value={editing.name}
              onChange={(e) => setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            />
            <input
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              value={editing.host}
              onChange={(e) => setEditing((prev) => (prev ? { ...prev, host: e.target.value } : prev))}
            />
            <input
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              type="number"
              value={editing.port}
              onChange={(e) =>
                setEditing((prev) => (prev ? { ...prev, port: Number(e.target.value) || prev.port } : prev))
              }
            />
            <input
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              value={editing.fromEmail}
              onChange={(e) => setEditing((prev) => (prev ? { ...prev, fromEmail: e.target.value } : prev))}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void submitEdit()} className="rounded-lg bg-accent px-3 py-2 text-sm text-white">
              Save Changes
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {accounts.map((account) => (
          <article key={account.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-white">{account.name}</p>
                <p className="text-xs text-zinc-400">
                  {account.host}:{account.port} · {account.encryption.toUpperCase()} · {account.providerLabel ?? "custom"}
                </p>
              </div>
              <StatusBadge label={account.isThrottled ? "throttled" : "healthy"} tone={account.isThrottled ? "warning" : "success"} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void toggleAccount(account)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200">
                {account.isActive ? "Disable" : "Enable"}
              </button>
              <button type="button" onClick={() => void editAccount(account)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200">
                Edit
              </button>
              <button type="button" onClick={() => void testConnection(account)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200">
                <PlugZap className="h-3.5 w-3.5" />
                Test Connection
              </button>
              <button type="button" onClick={() => void removeAccount(account)} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
