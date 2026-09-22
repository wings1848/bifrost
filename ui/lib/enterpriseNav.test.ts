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

/**
 * 这个仓库是否带企业源码（`app/enterprise` 软链接存在）。
 *
 * 企业构建里 `@enterprise/...` 解析到真实实现，占位页一个都不剩，
 * 死路清单**本来就该是空的**。所以源码比对只在 OSS 构建下有意义。
 */
const IS_ENTERPRISE_CHECKOUT = existsSync(ENTERPRISE_REAL);

/**
 * OSS 下**已被 `IS_ENTERPRISE` 门控**的入口：它们 import 了企业占位组件，但
 * `page.tsx` 自己拦了一层（OSS 下 `navigate()` 重定向走 + 返回 null），
 * 所以永远不会显示占位页。上游也已把它们从侧边栏排除。
 *
 * 这里**显式列出**而不是用正则猜。早期版本用「同一文件里出现 `IS_ENTERPRISE`
 * 且出现 `navigate(`」来判断，两个正则彼此无关：随便给一个真死路页加一句
 * 装饰性的 `IS_ENTERPRISE` 引用和一个 `useNavigate()`，它就会被静默当成例外、
 * 从死路清单里消失（实测 21 → 20）。改成白名单后，那两个 URL 必须在下面
 * 的测试里证明自己**真的**有门控，而其他页面再也无法靠巧合逃逸。
 */
const OSS_GATED_ENTRIES = ["/workspace/config/branding", "/workspace/config/license"];

const readIf = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** 把 `@enterprise/x/y`、`@/x`、相对路径解析成磁盘绝对路径。 */
function resolveModule(fromFile: string, spec: string): string | null {
	let base: string;
	if (spec.startsWith("@enterprise/")) {
		base = path.join(ENTERPRISE_ROOT, spec.slice("@enterprise/".length));
	} else if (spec.startsWith("@/")) {
		base = path.join(UI_ROOT, spec.slice("@/".length));
	} else if (spec.startsWith(".")) {
		base = path.resolve(path.dirname(fromFile), spec);
	} else {
		return null; // 第三方包，与 fallback 无关
	}
	for (const cand of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
		if (existsSync(cand) && statSync(cand).isFile()) return cand;
	}
	return null;
}

/**
 * 这个文件是 `ContactUsView` **本身的定义**，还是**渲染它**的组件？
 *
 * 两者都要算命中。早期版本只找 `<ContactUsView` JSX，于是 `contactUsView.tsx`
 * 自己（它只定义、不使用）被判为"不是占位"——凡是直接 import 这个定义文件并
 * 渲染它的页面都会被漏掉。
 */
function definesContactUs(src: string): boolean {
	return /export\s+default\s+function\s+ContactUsView\b/.test(src);
}

/** 组件（含 re-export 链）最终是否渲染 ContactUsView。 */
function rendersContactUs(file: string, seen = new Set<string>()): boolean {
	if (seen.has(file)) return false;
	seen.add(file);
	const src = readIf(file);
	if (src === null) return false;
	if (/<ContactUsView\b/.test(src) || definesContactUs(src)) return true;
	// 静态 import 与动态 import() 都要跟——`lazy(() => import(...))` 一样能渲染占位页。
	for (const m of src.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
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
 * 一个必须排除的例外，是"看着像占位、其实不是"：
 *
 * - `config/api-keys`：`apiKeysIndexView` 会读 core config 并渲染真实使用说明，
 *   底部才挂一块 Scope Based API Keys 的升级广告。页面是能用的，不能隐藏。
 *   它靠 `fetchesData` 自然排除（有 query），不需要特判。
 *
 * `config/branding` / `config/license` 走 `OSS_GATED_ENTRIES` 白名单。
 *
 * 判据是「组件里有没有数据请求」：占位组件清一色 15~33 行、0 个 query。
 */
function isDeadEnd(url: string): boolean {
	if (OSS_GATED_ENTRIES.includes(url)) return false;
	const resolved = followRedirect(url);
	const dir = routeEntryDir(resolved);
	for (const entry of ["page.tsx", "layout.tsx"]) {
		const file = path.join(dir, entry);
		const src = readIf(file);
		if (src === null) continue;
		// 只认这个入口自己 import 的企业组件，避免把同目录无关文件算进来。
		for (const m of src.matchAll(/from\s+"(@enterprise\/[^"]+)"/g)) {
			const target = resolveModule(file, m[1]);
			if (target && rendersContactUs(target) && !fetchesData(target)) return true;
		}
	}
	return false;
}

/**
 * 这个入口是否**真的**用 `IS_ENTERPRISE` 把自己挡住了。
 *
 * 光看"文件里有没有 `IS_ENTERPRISE` 字样"不够——那可能只是一句无关的引用。
 * 这里要求三件事同时成立：确实引了 `IS_ENTERPRISE`、确实有 `navigate(` 调用、
 * 且两者处在同一个 `if (!IS_ENTERPRISE)` 判断里（或等价的提前返回）。
 */
function hasEnterpriseGate(url: string): boolean {
	const dir = routeEntryDir(url);
	const src = readIf(path.join(dir, "page.tsx")) ?? "";
	const importsFlag = /import\s*\{[^}]*\bIS_ENTERPRISE\b[^}]*\}/.test(src);
	// `if (!IS_ENTERPRISE) { ... navigate(...) }` 允许中间有别的语句，
	// 但不能跨出这个大括号。
	const gatedBlock = /if\s*\(\s*!IS_ENTERPRISE\s*\)\s*\{([\s\S]*?)\}/.exec(src);
	const navigatesInsideGate = !!gatedBlock && /navigate\(/.test(gatedBlock[1]);
	// 门控后还要真的不渲染任何东西（`return null`），否则只是跳走、页面仍在。
	const returnsNull = /if\s*\(\s*!IS_ENTERPRISE\s*\)\s*\{\s*return\s+null\s*;?\s*\}/.test(src);
	return importsFlag && navigatesInsideGate && returnsNull;
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
	// 企业构建里 `@enterprise/...` 是真实实现，一个占位页都没有，
	// 死路清单本就该为空——那条断言只对 OSS 构建成立。
	it.skipIf(IS_ENTERPRISE_CHECKOUT)("侧边栏声明的死路 URL 与源码实测一致", async () => {
		const { ENTERPRISE_DEAD_END_NAV_URLS } = await import("./enterpriseNav");
		const declared = [...ENTERPRISE_DEAD_END_NAV_URLS].sort();

		const actual = sidebarUrls()
			.filter((u) => existsSync(routeEntryDir(u)) || existsSync(routeEntryDir(followRedirect(u))))
			.filter(isDeadEnd)
			.sort();

		expect(actual, "源码实测的死路入口变了：企业功能可能已实现（请从清单里删掉），或上游新增了死路入口（请补进清单）").toEqual(declared);
	});

	// 白名单不能是"免检通道"：这两个 URL 必须自己证明真的被 IS_ENTERPRISE 挡住了。
	// 上游哪天去掉门控，这条会红，而不是让占位页悄悄留在侧边栏里。
	it("白名单里的入口确实被 IS_ENTERPRISE 门控", () => {
		const ungated = OSS_GATED_ENTRIES.filter((u) => !hasEnterpriseGate(u));
		expect(ungated, "这些入口已不再被 IS_ENTERPRISE 门控，必须从 OSS_GATED_ENTRIES 移除并加进死路清单: " + ungated.join(" / ")).toEqual([]);
	});

	it("清单里的每个 URL 在侧边栏里确实用得到", async () => {
		const { ENTERPRISE_DEAD_END_NAV_URLS } = await import("./enterpriseNav");
		const declared = [...ENTERPRISE_DEAD_END_NAV_URLS];
		const inSidebar = new Set(sidebarUrls());
		const orphan = declared.filter((u) => !inSidebar.has(u));
		expect(orphan, "清单里有侧边栏已经不再声明的 URL（死代码）: " + orphan.join(" / ")).toEqual([]);
	});

	// 反向保护：白名单条目不得同时出现在死路清单里（自相矛盾）。
	it("白名单与死路清单互斥", async () => {
		const { ENTERPRISE_DEAD_END_NAV_URLS } = await import("./enterpriseNav");
		const both = OSS_GATED_ENTRIES.filter((u) => ENTERPRISE_DEAD_END_NAV_URLS.has(u));
		expect(both, "同一个 URL 不能既被门控又被当作死路: " + both.join(" / ")).toEqual([]);
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