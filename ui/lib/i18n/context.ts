import { createContext, useContext } from "react";
import type { Locale } from "./index";

export interface LocaleCtx {
	locale: Locale;
	switchLocale: (next: Locale) => void;
	t: (key: string, params?: Record<string, string | number>) => string;
}

export const LocaleContext = createContext<LocaleCtx>({
	locale: "zh",
	switchLocale: () => {},
	t: (key: string) => key,
});

export const useT = () => useContext(LocaleContext).t;
export const useLocaleCtx = () => useContext(LocaleContext);