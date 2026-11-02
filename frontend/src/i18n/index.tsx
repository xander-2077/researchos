// Minimal i18n: English source strings are the keys; other languages map them.
// Missing keys fall back to English, so untranslated text never breaks the UI.
import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { zh } from "./zh";

export type Lang = "en" | "zh";
export const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
];

const KEY = "researchos-lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* ignore */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let current: Lang = detect();
if (typeof document !== "undefined") document.documentElement.lang = current === "zh" ? "zh-CN" : "en";

const DICTS: Record<Lang, Record<string, string>> = { en: {}, zh };

export const getLang = () => current;

/** BCP-47 locale for Intl date/number formatting (undefined = browser default). */
export const locale = () => (current === "zh" ? "zh-CN" : undefined);

/** Translate an English source string; `{name}` placeholders are filled from `vars`. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = DICTS[current][s] ?? s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Translate only if the value is a plain string (handy for props typed as ReactNode). */
export function tn<T>(v: T): T | string {
  return typeof v === "string" ? t(v) : v;
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    setState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  // Re-mount the subtree on language change so every t() call re-renders (query cache lives above).
  return <Ctx.Provider value={value}><Fragment key={lang}>{children}</Fragment></Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
