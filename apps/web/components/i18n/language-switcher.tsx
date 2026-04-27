"use client";

import { useI18n } from "@/components/i18n/i18n-provider";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="flex items-center justify-center rounded-xl border border-border bg-zinc-900/70 p-1.5">
      <label className="sr-only" htmlFor="language-switcher">
        {t("shell.language")}
      </label>
      <select
        id="language-switcher"
        value={language}
        onChange={(event) => setLanguage(event.target.value === "tr" ? "tr" : "en")}
        className="w-full rounded-md border border-border bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-200"
      >
        <option value="en">EN</option>
        <option value="tr">TR</option>
      </select>
    </div>
  );
}
