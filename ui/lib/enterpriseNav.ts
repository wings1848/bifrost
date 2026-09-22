/**
 * 企业功能的「死路入口」清单与过滤。
 *
 * ## 背景
 *
 * Bifrost 的企业版是另一个私有仓库，通过软链接到 `ui/app/enterprise`（见
 * `.gitignore`）。OSS 构建里 `@enterprise/...` 由 vite alias 落到
 * `ui/app/_fallbacks/enterprise/...` —— 那里是一堆最终渲染 `ContactUsView` 的
 * 占位组件（"此功能属于 Bifrost 企业许可" + Read more / Book a demo）。
 *
 * 问题出在**侧边栏判断维度和功能实际存在与否脱节**：
 *
 * - 侧边栏用 RBAC 决定显示（`useRbac(RbacResource.X, ...)`，33 处调用）
 * - OSS 的 `useRbac` 是桩，恒返回 `true`（`_fallbacks/.../rbacContext.tsx`）
 * - 官方只对 3 处补了 `IS_ENTERPRISE` 判断（Proxy / Branding / License）
 *
 * 结果：OSS 下所有企业入口都显示，点进去才发现是死路。侧边栏声明了 61 个不同的
 * `/workspace` 目的地（含父分组自身的 url），其中 21 个是死路：告警 4、治理 7、
 * 护栏 3、边缘控制 3、集群 1、自适应路由 2、模型分组里的熔断器 1。
 * 21 这个数字由 `enterpriseNav.test.ts` 每次从源码重算并双向比对。
 *
 * ## 这里做什么
 *
 * 不从侧边栏里删条目（那会和上游永久冲突，且官方
 * `tests/e2e/features/placeholders/placeholders.spec.ts` 正是靠直接访问这些 URL
 * 来验收占位页的）。只提供一个**默认关闭**的过滤器：开关打开时，侧边栏不显示
 * 这些死路；URL 直达仍然可用，E2E 不受影响。
 *
 * 清单由 `enterpriseNav.test.ts` 从源码双向校验：上游实现某个企业功能后，
 * 那个 URL 会从实测死路里消失，测试立刻变红提醒同步清单。
 */

/** 侧边栏里指向企业占位页的 URL。改这个集合必须同时让 enterpriseNav.test.ts 通过。 */
export const ENTERPRISE_DEAD_END_NAV_URLS: ReadonlySet<string> = new Set([
	// 告警（4）
	"/workspace/alerting",
	"/workspace/alerting/channels",
	"/workspace/alerting/rules",
	"/workspace/alerting/history",
	// 治理（6）：虚拟密钥/团队/客户是真的，其余是占位
	"/workspace/governance/users",
	"/workspace/governance/business-units",
	"/workspace/scim",
	"/workspace/governance/rbac",
	"/workspace/governance/access-profiles",
	"/workspace/governance/projects",
	"/workspace/audit-logs",
	// 护栏（3）
	"/workspace/guardrails",
	"/workspace/guardrails/configuration",
	"/workspace/guardrails/providers",
	// 边缘控制（3）：父项 /workspace/edge-control 本身没有 page.tsx（直访 404），
	// 且它是带子项的分组，过滤器只查子项——三个子项全死，整组会消失，
	// 所以父 URL 无需单独列出。
	"/workspace/edge-control/devices",
	"/workspace/edge-control/inventory",
	"/workspace/edge-control/config",
	// 集群配置（1）
	"/workspace/cluster",
	// 自适应路由（3）
	"/workspace/adaptive-routing",
	"/workspace/adaptive-routing/settings",
	// 模型分组里的熔断器（1）
	"/workspace/circuit-breaker",
]);

/** 过滤所需的最小结构；不直接依赖 SidebarItem 以避免循环 import。 */
export interface NavItemLike {
	url?: string;
	subItems?: NavItemLike[];
}

/**
 * 按开关过滤掉死路入口。
 *
 * - `hidden === false`（默认）：原样返回同一个引用，行为与本改动前完全一致。
 * - `hidden === true`：递归摘掉死路子项；某个分组若摘完不再剩任何子项，整组也去掉。
 *   不修改传入的对象（`accessibleItems` 是 useMemo 的产物，就地改会污染缓存）。
 */
export function filterHiddenNavItems<T extends NavItemLike>(items: T[], hidden: boolean): T[] {
	if (!hidden) return items;
	const out: T[] = [];
	for (const item of items) {
		if (item.subItems?.length) {
			const kept = filterHiddenNavItems(item.subItems as T[], hidden);
			if (kept.length === 0) continue;
			out.push({ ...item, subItems: kept });
			continue;
		}
		if (item.url && ENTERPRISE_DEAD_END_NAV_URLS.has(item.url)) continue;
		out.push(item);
	}
	return out;
}