import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 回归钉：侧边栏不再出现「新版本已发布」提示卡（new-release 卡片）。
// 该卡片会向 getbifrost.ai 请求最新版本并与本地版本比较，对不跟随上游
// 版本号的自定义部署只会持续误报，因此整体移除，且不允许被重新引入。
// 见 ui/components/sidebar.tsx 的 promoCards 与 ui/lib/store/apis/configApi.ts。

const read = (relPath: string) => readFileSync(new URL(relPath, import.meta.url), "utf8");

describe("sidebar 不再渲染版本更新提示卡", () => {
	it("sidebar.tsx 不包含 new-release 卡片与版本比较逻辑", () => {
		const src = read("./sidebar.tsx");
		expect(src).not.toContain('id: "new-release"');
		expect(src).not.toContain("showNewReleaseBanner");
		expect(src).not.toContain("compareVersions");
	});

	it("configApi.ts 不再请求 getbifrost.ai/latest-release", () => {
		const src = read("../lib/store/apis/configApi.ts");
		expect(src).not.toContain("getLatestRelease");
		expect(src).not.toContain("latest-release");
	});
});