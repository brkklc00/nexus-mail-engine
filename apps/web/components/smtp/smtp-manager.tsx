"use client";

import { useState } from "react";
import { PlusCircle, PlugZap, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";

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
  const [accounts, setAccounts] = useState(initialAccounts);
  const [toast, setToast] = useState<string | null>(null);
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

  async function createAccount() {
    const response = await fetch("/api/smtp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      setToast(payload.error ?? "SMTP create failed");
      return;
    }
    setAccounts((prev) => [payload.account!, ...prev]);
    setToast("SMTP account created");
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
    const response = await fetch(`/api/smtp/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !account.isActive })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      setToast(payload.error ?? "Update failed");
      return;
    }
    setAccounts((prev) => prev.map((item) => (item.id === account.id ? payload.account! : item)));
    setToast("SMTP state updated");
    router.refresh();
  }

  async function testConnection(account: Account) {
    const response = await fetch(`/api/smtp/${account.id}/test-connection`, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setToast(response.ok && payload.ok ? "Connection successful" : payload.error ?? "Connection failed");
  }

  async function editAccount(account: Account) {
    const nextName = window.prompt("SMTP name", account.name) ?? account.name;
    const nextHost = window.prompt("SMTP host", account.host) ?? account.host;
    const nextPort = Number(window.prompt("SMTP port", String(account.port)) ?? account.port);
    const nextFromEmail = window.prompt("From email", account.fromEmail) ?? account.fromEmail;
    const response = await fetch(`/api/smtp/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nextName,
        host: nextHost,
        port: nextPort,
        fromEmail: nextFromEmail
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      setToast(payload.error ?? "Update failed");
      return;
    }
    setAccounts((prev) => prev.map((item) => (item.id === account.id ? payload.account! : item)));
    setToast("SMTP updated");
    router.refresh();
  }

  async function removeAccount(account: Account) {
    const response = await fetch(`/api/smtp/${account.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setToast(payload.error ?? "Delete failed");
      return;
    }
    setAccounts((prev) => prev.filter((item) => item.id !== account.id));
    setToast("SMTP removed");
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
        {toast ? <p className="mt-2 text-xs text-zinc-300">{toast}</p> : null}
      </div>

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
