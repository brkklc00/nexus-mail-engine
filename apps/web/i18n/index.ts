import en from "@/i18n/en";
import tr from "@/i18n/tr";

export type Language = "en" | "tr";

export const I18N_STORAGE_KEY = "nexus_lang";
export const I18N_COOKIE_KEY = "nexus_lang";
export const DEFAULT_LANGUAGE: Language = "en";

export const dictionaries = {
  en,
  tr
} as const;

export type TranslationTree = typeof en;

export function getByPath(source: Record<string, any>, path: string): string | undefined {
  const keys = path.split(".");
  let cursor: any = source;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = cursor[key];
  }
  return typeof cursor === "string" ? cursor : undefined;
}
