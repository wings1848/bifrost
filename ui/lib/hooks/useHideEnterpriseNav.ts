"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "bifrost.hideEnterpriseNav";

/**
 * 是否在侧边栏里隐藏「企业功能死路入口」。
 *
 * 背景见 `lib/enterpriseNav.ts`：OSS 构建下企业功能是占位页，但侧边栏基于 RBAC
 * 判断显示，而 OSS 的 `useRbac` 恒返回 true，于是这些入口全都露出来。开关打开后
 * 侧边栏不再显示它们（URL 直达仍然可用）。
 *
 * 与 `useTimezonePreference` 同样的形状：默认 **false**（=不改变现有行为），
 * 挂载后再从 localStorage 读，避免 SSR 水合不一致。
 */
export function useHideEnterpriseNav(): [boolean, (next: boolean) => void] {
	const [hidden, setHiddenState] = useState(false);

	// 挂载后读取，避免水合不一致。
	useEffect(() => {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored === "true") setHiddenState(true);
		} catch {
			// localStorage 不可用（隐私模式等）——保持默认
		}
	}, []);

	const setHidden = useCallback((next: boolean) => {
		setHiddenState(next);
		try {
			localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
		} catch {
			// 记不住也不影响本次会话的显示
		}
	}, []);

	return [hidden, setHidden];
}

/** 供设置页和测试复用，避免字符串散落两处。 */
export const HIDE_ENTERPRISE_NAV_STORAGE_KEY = STORAGE_KEY;