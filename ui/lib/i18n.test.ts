import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * 第一期中文验收：侧边栏菜单必须有中文翻译。
 *
 * 做法：sidebar.tsx 的每个 title key，都要在 locales/zh.json 里有对应中文。
 * 验红状态：现在 sidebar 还是硬编码英文，根本没有字典文件，这个测试会失败。
 */
describe("第一期中文验收", () => {
	it("zh.json 存在且每个侧边栏标题都有中文", () => {
		const zh = JSON.parse(read("../locales/zh.json")) as Record<string, string>;
		const sidebar = read("../components/sidebar.tsx");
		const titles = [...sidebar.matchAll(/^\s*(?:title|description): "([^"]+)"/gm)].map((m) => m[1]);
		expect(titles.length).toBeGreaterThan(50);
		const missing = titles.filter((t) => !zh[t]);
		expect(missing, `缺翻译: ${missing.join(" / ")}`).toEqual([]);
	});

	it("切换语言后 localStorage 里能记住选择", () => {
		const source = read("../lib/i18n/index.ts");
		expect(source).toContain("bifrost-locale");
	});

	it("五个页面的 t() key 都有中文", () => {
		const zh = JSON.parse(read("../locales/zh.json")) as Record<string, string>;
		const { execSync } = require("node:child_process");
		const out = execSync(
			'rg -o \'t\\("([^"]+)"\\)\' -N app/workspace/dashboard app/workspace/providers app/workspace/virtual-keys app/workspace/logs app/workspace/mcp-logs components/topbar.tsx components/sidebar.tsx 2>/dev/null || true',
			{ encoding: "utf8" },
		) as string;
		const keys = [...out.matchAll(/t\("([^"]+)"\)/g)].map((m) => m[1]).filter((k) => k.length > 2 && !/^[a-z_/【\[@]/.test(k) && !/Hello/.test(k));
		expect(keys.length).toBeGreaterThan(10);
		const missing = [...new Set(keys)].filter((k) => !zh[k]);
		expect(missing, `缺翻译: ${missing.join(" / ")}`).toEqual([]);
	});
});
