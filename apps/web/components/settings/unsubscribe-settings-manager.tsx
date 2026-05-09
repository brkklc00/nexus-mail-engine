"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/notification-provider";

type SettingsForm = {
  enabled: boolean;
  title: string;
  description: string;
  successMessage: string;
  errorMessage: string;
  captchaEnabled: boolean;
  captchaExpiryMinutes: number;
  maxAttempts: number;
  allowManualEmailInput: boolean;
  requireToken: boolean;
  removeFromAllLists: boolean;
  addToSuppression: boolean;
  suppressionReason: string;
  footerText: string;
};

const defaults: SettingsForm = {
  enabled: true,
  title: "Abonelikten Cik",
  description: "E-posta adresinizi tum gonderim listelerinden cikarmak icin dogrulama kodunu girin.",
  successMessage:
    "E-posta adresiniz tum listelerden cikarildi ve tekrar gonderim yapilmamasi icin baskilama listesine eklendi.",
  errorMessage: "Dogrulama kodu hatali veya suresi dolmus.",
  captchaEnabled: true,
  captchaExpiryMinutes: 10,
  maxAttempts: 5,
  allowManualEmailInput: true,
  requireToken: false,
  removeFromAllLists: true,
  addToSuppression: true,
  suppressionReason: "unsubscribe",
  footerText: ""
};

export function UnsubscribeSettingsManager() {
  const toast = useToast();
  const [form, setForm] = useState<SettingsForm>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/unsubscribe-settings", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; settings?: Partial<SettingsForm> };
        if (!response.ok || !payload.ok || !payload.settings) {
          throw new Error("Ayarlar yuklenemedi");
        }
        setForm((prev) => ({ ...prev, ...payload.settings }));
      } catch (error) {
        toast.error("Ayarlar yuklenemedi", error instanceof Error ? error.message : "Beklenmeyen hata");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/unsubscribe-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; settings?: SettingsForm; error?: string };
      if (!response.ok || !payload.ok || !payload.settings) {
        throw new Error(payload.error ?? "Kayit basarisiz");
      }
      setForm(payload.settings);
      toast.success("Ayarlar kaydedildi");
    } catch (error) {
      toast.error("Ayarlar kaydedilemedi", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-lg border border-border bg-card p-4 text-sm text-zinc-300">Yukleniyor...</div>;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle label="Sayfa aktif" checked={form.enabled} onChange={(value) => setForm((s) => ({ ...s, enabled: value }))} />
        <Toggle label="Resimli dogrulama aktif" checked={form.captchaEnabled} onChange={(value) => setForm((s) => ({ ...s, captchaEnabled: value }))} />
        <Toggle label="Manuel e-posta girisine izin ver" checked={form.allowManualEmailInput} onChange={(value) => setForm((s) => ({ ...s, allowManualEmailInput: value }))} />
        <Toggle label="Gecerli token zorunlu" checked={form.requireToken} onChange={(value) => setForm((s) => ({ ...s, requireToken: value }))} />
        <Toggle label="Tum listelerden cikar" checked={form.removeFromAllLists} onChange={(value) => setForm((s) => ({ ...s, removeFromAllLists: value }))} />
        <Toggle label="Baskilama listesine ekle" checked={form.addToSuppression} onChange={(value) => setForm((s) => ({ ...s, addToSuppression: value }))} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Baslik"><input className="w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} /></Field>
        <Field label="Baskilama nedeni"><input className="w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.suppressionReason} onChange={(e) => setForm((s) => ({ ...s, suppressionReason: e.target.value }))} /></Field>
        <Field label="Dogrulama suresi"><input type="number" min={1} max={60} className="w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.captchaExpiryMinutes} onChange={(e) => setForm((s) => ({ ...s, captchaExpiryMinutes: Number(e.target.value || 10) }))} /></Field>
        <Field label="Maksimum deneme hakki"><input type="number" min={1} max={20} className="w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.maxAttempts} onChange={(e) => setForm((s) => ({ ...s, maxAttempts: Number(e.target.value || 5) }))} /></Field>
      </div>

      <div className="mt-4 space-y-3">
        <Field label="Aciklama">
          <textarea className="min-h-[84px] w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
        </Field>
        <Field label="Basari mesaji">
          <textarea className="min-h-[84px] w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.successMessage} onChange={(e) => setForm((s) => ({ ...s, successMessage: e.target.value }))} />
        </Field>
        <Field label="Hata mesaji">
          <textarea className="min-h-[64px] w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.errorMessage} onChange={(e) => setForm((s) => ({ ...s, errorMessage: e.target.value }))} />
        </Field>
        <Field label="Ozellestirilmis alt not">
          <input className="w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={form.footerText} onChange={(e) => setForm((s) => ({ ...s, footerText: e.target.value }))} />
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Kaydediliyor..." : "Ayarlari Kaydet"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

