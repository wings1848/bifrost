import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(UI_ROOT, relative), "utf8");

/** 第二期中文验收：MCP 相关六个页面。 */
const I18N_TARGETS = [
	"app/workspace/mcp-registry",
	"app/workspace/virtual-mcps",
	"app/workspace/mcp-sessions",
	"app/workspace/oauth-grants",
	"app/workspace/config/views/mcpView.tsx",
	"app/_fallbacks/enterprise/components/mcp-auth-config",
	// 第三期：共享筛选组件（一处改动覆盖 7+ 页面）与 config 设置页
	"components/filters",
	"app/workspace/config",
	"app/_fallbacks/enterprise/components/branding",
	"app/_fallbacks/enterprise/components/large-payload",
];

/** 这些属性承载用户可见文案，只要写成字符串字面量就必须走 t()。 */
const TEXT_ATTRS = [
	"placeholder",
	"title",
	"aria-label",
	"alt",
	"tooltip",
	"emptyMessage",
	"confirmText",
	"cancelText",
	// 传给自定义展示组件的文案属性，同样是用户可见文案
	"label",
	"header",
	"description",
	"subtitle",
	"emptyText",
];

/**
 * 不翻的东西：代码、URL、标识符、纯大写缩写、已经是中文的。
 *
 * HTML 实体（`&quot;` `&apos;` `&amp;` 等）是 JSX 里的标点，不是文案：
 * 先把实体折叠成对应字符再判定，否则 `{t("Use")} <span>&quot;{x}&quot;</span>`
 * 这行会因为 `&quot;` 含 `quot` 而被当成硬编码英文（实测误报）。
 * 折叠后若已不含长度 ≥3 的字母串（只剩标点/符号），自然被排除。
 */
const looksEnglish = (s: string) =>
	/[A-Za-z]{3}/.test(s.replace(/&(?:quot|apos|amp|lt|gt|nbsp|#\d+);/g, "")) &&
	!/[\u4e00-\u9fff]/.test(s) &&
	!/^(?:https?:|\/|\.\/|--|npx |curl |docker |git )/.test(s) &&
	!/^[A-Z0-9_]+$/.test(s) &&
	!/^\{.*\}$/.test(s);

const ALLOWED = new Set<string>([
	// 占位符/变量拼接出来的属性值，由其它断言覆盖
]);

function collectFiles(target: string, out: string[] = []): string[] {
	const abs = path.join(UI_ROOT, target);
	const st = statSync(abs);
	if (st.isFile()) {
		if (/\.tsx?$/.test(target) && !/\.test\.tsx?$/.test(target)) out.push(abs);
		return out;
	}
	for (const entry of readdirSync(abs, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		collectFiles(path.join(target, entry.name), out);
	}
	return out;
}

/**
 * 找出仍然硬编码英文的 JSX 文案与文案属性。
 *
 * 必须走 AST：朴素正则会把 TS 泛型 `<Record<string, void>;` 之类的代码
 * 当成 JSX 文本误报（实测踩过）。这里只认真正的 JsxText 节点和
 * 写成字符串字面量的文案属性。
 */

/**
 * JSX 文本里的「单个词」何时算代码而不是文案。
 *
 * 早期版本要求文案必须 ≥4 字符且含空格，于是 `{t("Client")}` 被改回裸
 * `Client` 时测试照样全绿（实测漏报）。单词按钮/列头同样是用户可见文案，
 * 必须抓；这里只放过明显的代码/标识符形态。
 */
function isCodeToken(value: string): boolean {
	if (/\s/.test(value)) return false; // 多词一律当文案
	if (/[_/.:@]/.test(value)) return true; // 含 . / : @ _ → 代码/标识符
	if (value === value.toUpperCase()) return true; // MCP / JWT / SSE
	if (/^[a-z]/.test(value)) return true; // stdio / npx 这类小写标识符
	return false; // Client / Cancel / Save 这类首字母大写单词 → 文案
}

function findHardcodedEnglish(files: string[]): string[] {
	const hits: string[] = [];
	for (const file of files) {
		const src = readFileSync(file, "utf8");
		const rel = path.relative(UI_ROOT, file);
		const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
		const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

		const visit = (node: ts.Node) => {
			if (ts.isJsxText(node)) {
				const value = node.text.replace(/\s+/g, " ").trim();
				if (looksEnglish(value) && !ALLOWED.has(value) && !isCodeToken(value)) {
					hits.push(`${rel}:${lineOf(node.getStart(sf))} >${value}<`);
				}
			}
			if (
				ts.isJsxAttribute(node) &&
				node.initializer &&
				ts.isStringLiteral(node.initializer) &&
				TEXT_ATTRS.includes(node.name.getText(sf))
			) {
				const value = node.initializer.text;
				if (looksEnglish(value) && !ALLOWED.has(value)) {
					hits.push(`${rel}:${lineOf(node.getStart(sf))} ${node.name.getText(sf)}="${value}"`);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	return hits;
}

/**
 * 用 AST 收集所有 t("...") 调用里的 key。
 *
 * 必须走 AST 而不是正则：带参数的形式 `t("k", { … })` 与跨行的调用
 * 都匹配不到单参数正则，运行时那些 key 若不在词典里就会静默回落英文，
 * 测试却全绿（实测踩过：25 个带参数的调用里 17 个 key 缺失）。
 */
function collectTranslationKeys(files: string[]): Map<string, string[]> {
	const used = new Map<string, string[]>();
	for (const file of files) {
		const src = readFileSync(file, "utf8");
		const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
		const rel = path.relative(UI_ROOT, file);
		const visit = (node: ts.Node) => {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
				const arg = node.arguments[0];
				if (arg && ts.isStringLiteral(arg)) {
					if (!used.has(arg.text)) used.set(arg.text, []);
					used.get(arg.text)!.push(rel);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	return used;
}

describe("第二期中文验收：MCP 六个页面", () => {
	const files = I18N_TARGETS.flatMap((t) => collectFiles(t));

	it("目标页面文件都被收集到", () => {
		expect(files.length).toBeGreaterThan(40);
	});

	it("没有硬编码英文界面文案（JSX 文本与文案属性都已走 t()）", () => {
		const hits = findHardcodedEnglish(files);
		expect(hits, `仍有硬编码英文:\n${hits.join("\n")}`).toEqual([]);
	});

	it("页面里用到的 t() 键全部能在 zh.json 找到中文（含带参数调用）", () => {
		const zh = JSON.parse(read("locales/zh.json")) as Record<string, string>;
		const used = collectTranslationKeys(files);
		expect(used.size).toBeGreaterThan(100);
		const missing = [...used.keys()].filter((k) => !zh[k]);
		expect(missing, `缺翻译: ${missing.join(" / ")}`).toEqual([]);
	});

	it("占位符在原文与译文之间一一对应", () => {
		const zh = JSON.parse(read("locales/zh.json")) as Record<string, string>;
		const tokens = (s: string) => [...s.matchAll(/\{[a-zA-Z0-9_]+\}|%s|%d/g)].map((m) => m[0]).sort();
		const mismatches: string[] = [];
		const allKeys = collectTranslationKeys(files);
		for (const [key] of allKeys) {
			const translated = zh[key];
			if (!translated) continue;
			if (JSON.stringify(tokens(key)) !== JSON.stringify(tokens(translated))) mismatches.push(`${key} => ${translated}`);
		}
		for (const file of files) {
			const keysInFile = [...allKeys.entries()].filter(([, fs]) => fs.includes(path.relative(UI_ROOT, file))).map(([k]) => k);
			for (const key of keysInFile) {
				const translated = zh[key];
				if (!translated) continue;
				if (JSON.stringify(tokens(key)) !== JSON.stringify(tokens(translated))) {
					mismatches.push(`${key} => ${translated}`);
				}
			}
		}
		expect(mismatches, `占位符不匹配:\n${mismatches.join("\n")}`).toEqual([]);
	});
});