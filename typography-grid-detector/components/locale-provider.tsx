"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { STRINGS, type Locale } from "@/lib/ui-dictionary";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
};

const LocaleContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "typography-ui-locale";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s === "en" || s === "zh") setLocaleState(s);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }, [locale, ready]);

  const t = useMemo(
    () => (key: string) => STRINGS[locale][key] ?? STRINGS.zh[key] ?? key,
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useI18n(): Ctx {
  const c = useContext(LocaleContext);
  if (!c) {
    throw new Error("useI18n must be used within LocaleProvider");
  }
  return c;
}
