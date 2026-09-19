import { useCallback, useEffect, useState } from "react";
import en from "../../locales/en.json";
import zh from "../../locales/zh.json";

export type Locale = "zh" | "en";

const STORAGE_KEY = "bifrost-locale";

const dicts: Record<Locale, Record<string, string>> = {
	zh,
	en,
};

function readStored(): Locale {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === "en" || v === "zh") return v;
	} catch {
		// localStorage 不可用就用默认中文
	}
	return "zh";
}

/**
 * 极简语言 hook：查字典，有就返回中文，没有就回退英文。
 * 不引入 i18next，零依赖，升级官方代码也不冲突。
 */
export function useLocale() {
	const [locale, setLocale] = useState<Locale>("zh");

	useEffect(() => {
		setLocale(readStored());
	}, []);

	const switchLocale = useCallback((next: Locale) => {
		setLocale(next);
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// 记住失败也不影响当前显示
		}
	}, []);

	const t = useCallback(
		(key: string): string => {
			return dicts[locale][key] ?? dicts.en[key] ?? key;
		},
		[locale],
	);

	return { locale, switchLocale, t };
}
