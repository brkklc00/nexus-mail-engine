"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LANGUAGE, dictionaries, getByPath, I18N_COOKIE_KEY, I18N_STORAGE_KEY, type Language } from "@/i18n";

type I18nContextValue = {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookieLanguage(): Language | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${I18N_COOKIE_KEY}=`));
  if (!entry) return null;
  const value = entry.split("=")[1];
  return value === "tr" ? "tr" : value === "en" ? "en" : null;
}

function readInitialLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const fromStorage = window.localStorage.getItem(I18N_STORAGE_KEY);
  if (fromStorage === "en" || fromStorage === "tr") return fromStorage;
  const fromCookie = readCookieLanguage();
  if (fromCookie) return fromCookie;
  return DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    setLanguageState(readInitialLanguage());
  }, []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(I18N_STORAGE_KEY, next);
    }
    if (typeof document !== "undefined") {
      document.cookie = `${I18N_COOKIE_KEY}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
    }
  };

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
      document.cookie = `${I18N_COOKIE_KEY}=${language}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: string, fallback?: string) => {
      const localized = getByPath(dictionaries[language] as any, key);
      if (localized) return localized;
      const english = getByPath(dictionaries.en as any, key);
      if (english) return english;
      return fallback ?? key;
    };
    return { language, setLanguage, t };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
