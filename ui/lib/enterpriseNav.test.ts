import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(UI_ROOT, "app");

/**
 * 官方把「企业功能没实现」表达成一层 fallback：`@enterprise/...` 在没有企业源码的
 * 构建里解析到 `app/_fallbacks/enterprise/...`，那里是一堆最终渲染 `ContactUsView`
 * 的占位组件（"此功能属于 Bifrost 企业许可" + Read more / Book a demo）。
 *
 * 问题在于**侧边栏用的判断维度是 RBAC，不是"功能存不存在"**。OSS 的 `useRbac`
 * 恒返回 true（`_fallbacks/.../rbacContext.tsx`），于是所有企业入口都显示出来，
 * 点进去才发现是死路。这个测试把"哪些入口是死路"从源码里算出来并钉住。
 */

/** `@enterprise` 在 OSS 构建里落到 fallback 目录（与 vite.config.mts 的 alias 一致）。 */
const ENTERPRISE_REAL = path.join(APP, "enterprise");
const ENTERPRISE_FALLBACK = path.join(APP, "_fallbacks", "enterprise");
const ENTERPRISE_ROOT = existsSync(ENTERPRISE_REAL) ? ENTERPRISE_REAL : ENTERPRISE_FALLBACK;

const readIf = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** 把 `@enterprise/x/y` 或相对路径解析成磁盘绝对路径（不带扩展名）。 */
function resolveModule(fromFile: string, spec: string): string | null {
	let base: string;
	if (spec.startsWith("@enterprise/")) {
		base = path.join(ENTERPRISE_ROOT, spec.slice("@enterprise/".length));
	} else if (spec.startsWith(".")) {
		base = path.resolve(path.dirname(fromFile), spec);
	} else {
		return null; // 第三方包 / 别名，与 fallback 无关
	}
	for (const cand of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
		if (existsSync(cand) && statSync(cand).isFile()) return cand;
	}
	return null;
}

/** 组件（含 re-export 链）最终是否渲染 ContactUsView。 */
function rendersContactUs(file: string, seen = new Set<string>()): boolean {
	if (seen.has(file)) return false;
	seen.add(file);
	const src = readIf(file);
	if (src === null) return false;
	if (/<ContactUsView\b/.test(src)) return true;
	for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
		const target = resolveModule(file, m[1]);
		if (target && rendersContactUs(target, seen)) return true;
	}
	return false;
}

/** 路由 URL → 该路由实际渲染的入口文件（page.tsx，回退到 layout.tsx）。 */
function routeEntryDir(url: string): string {
	return path.join(APP, url.replace(/^\/+/, ""));
}

/**
 * 跟随 layout.tsx 里的 `redirect({ to })`——`/workspace/alerting` 自己没有 page.tsx，
 * 靠 layout 跳到 `/workspace/alerting/rules`，死路判定必须落在真正的目标上。
 */
function followRedirect(url: string, hops = 0): string {
	if (hops > 4) return url;
	const dir = routeEntryDir(url);
	const layout = readIf(path.join(dir, "layout.tsx"));
	if (!layout) return url;
	const m = layout.match(/redirect\(\{\s*to:\s*"([^"]+)"/);
	if (!m) return url;
	const target = m[1];
	return target === url ? url : followRedirect(target, hops + 1);
}

/**
 * 真·死路判据：入口 import 的企业组件**只渲染 ContactUsView，不请求任何数据**。
 *
 * 两个必须排除的例外，都是"看着像占位、其实不是"：
 *
 * - `config/api-keys`：`apiKeysIndexView` 会读 core config 并渲染真实使用说明，
 *   底部才挂一块 Scope Based API Keys 的升级广告。页面是能用的，不能隐藏。
 * - `config/branding` / `config/license`：`page.tsx` 自己用 `IS_ENTERPRISE` 包了
 *   一层，OSS 下 `navigate()` 重定向到 client-settings 并返回 null。
 *   它们**根本不会显示占位页**，上游也已用 `...(IS_ENTERPRISE ? [...] : [])`
 *   把它们从侧边栏排除了。
 *
 * 判据是「组件里有没有数据请求」：占位组件清一色 15~33 行、0 个 query。
 */
function isDeadEnd(url: string): boolean {
	const resolved = followRedirect(url);
	const dir = routeEntryDir(resolved);
	for (const entry of ["page.tsx", "layout.tsx"]) {
		const file = path.join(dir, entry);
		const src = readIf(file);
		if (src === null) continue;
		// 入口自己用 IS_ENTERPRISE 门控并重定向 → 不会渲染占位页
		if (/IS_ENTERPRISE/.test(src) && /navigate\(/.test(src)) continue;
		// 只认这个入口自己 import 的企业组件，避免把同目录无关文件算进来。
		for (const m of src.matchAll(/from\s+"(@enterprise\/[^"]+)"/g)) {
			const target = resolveModule(file, m[1]);
			if (target && rendersContactUs(target) && !fetchesData(target)) return true;
		}
	}
	return false;
}

/** 组件（含 re-export 链）是否会发起数据请求——有数据请求说明不是纯占位。 */
function fetchesData(file: string, seen = new Set<string>()): boolean {
	if (seen.has(file)) return false;
	seen.add(file);
	const src = readIf(file);
	if (src === null) return false;
	if (/use(?:Get|List|Update|Create|Delete)[A-Za-z]*Query|useMutation|useSelector/.test(src)) return true;
	for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
		const target = resolveModule(file, m[1]);
		if (target && fetchesData(target, seen)) return true;
	}
	return false;
}

/** 侧边栏里声明的所有目的地 URL。 */
function sidebarUrls(): string[] {
	const src = readFileSync(path.join(UI_ROOT, "components", "sidebar.tsx"), "utf8");
	const urls = [...src.matchAll(/url:\s*"(\/workspace[^"]*)"/g)].map((m) => m[1]);
	return [...new Set(urls)];
}

describe("企业死路入口清单", () => {
	it("侧边栏声明的死路 URL 与源码实测一致", async () => {
		const { ENTERPRISE_DEAD_END_NAV_URLS } = await import("./enterpriseNav");
		const declared = [...ENTERPRISE_DEAD_END_NAV_URLS].sort();

		const actual = sidebarUrls()
			.filter((u) => existsSync(routeEntryDir(u)) || existsSync(routeEntryDir(followRedirect(u))))
			.filter(isDeadEnd)
			.sort();

		expect(actual, "源码实测的死路入口变了：企业功能可能已实现（请从清单里删掉），或上游新增了死路入口（请补进清单）").toEqual(declared);
	});

	it("清单里的每个 URL 在侧边栏里确实用得到", async () => {
		const { ENTERPRISE_DEAD_END_NAV_URLS } = await import("./enterpriseNav");
		const declared = [...ENTERPRISE_DEAD_END_NAV_URLS];
		const inSidebar = new Set(sidebarUrls());
		const orphan = declared.filter((u) => !inSidebar.has(u));
		expect(orphan, "清单里有侧边栏已经不再声明的 URL（死代码）: " + orphan.join(" / ")).toEqual([]);
	});
});

describe("侧边栏过滤是纯函数且默认不改变行为", () => {
	it("开关关闭时原样返回", async () => {
		const { filterHiddenNavItems, ENTERPRISE_DEAD_END_NAV_URLS } = await import("./enterpriseNav");
		const items = [
			{ title: "Observability", url: "/workspace/logs", subItems: [{ title: "Dashboard", url: "/workspace/dashboard" }] },
			{ title: "Alerting", url: "/workspace/alerting", subItems: [{ title: "Rules", url: "/workspace/alerting/rules" }] },
		];
		const out = filterHiddenNavItems(items, false);
		expect(out).toEqual(items);
		expect(ENTERPRISE_DEAD_END_NAV_URLS.size).toBeGreaterThan(10);
	});

	it("开关打开时整组只在还有活着的子项时保留", async () => {
		const { filterHiddenNavItems } = await import("./enterpriseNav");
		const items = [
			{
				title: "Models",
				url: "/workspace/providers",
				subItems: [
					{ title: "Model Providers", url: "/workspace/providers" },
					{ title: "Circuit Breaker", url: "/workspace/circuit-breaker" },
				],
			},
			{ title: "Alerting", url: "/workspace/alerting", subItems: [{ title: "Rules", url: "/workspace/alerting/rules" }] },
			{ title: "Plugins", url: "/workspace/plugins" },
		];
		const out = filterHiddenNavItems(items, true);

		// Models 还有一个活着的子项，保留，但死路子项被摘掉
		expect(out.map((i) => i.title)).toEqual(["Models", "Plugins"]);
		expect(out[0].subItems?.map((s) => s.title)).toEqual(["Model Providers"]);
	});

	it("打开时不改动传入的数组", async () => {
		const { filterHiddenNavItems } = await import("./enterpriseNav");
		const items = [{ title: "Alerting", url: "/workspace/alerting", subItems: [{ title: "Rules", url: "/workspace/alerting/rules" }] }];
		const snapshot = JSON.stringify(items);
		filterHiddenNavItems(items, true);
		expect(JSON.stringify(items)).toBe(snapshot);
	});
});