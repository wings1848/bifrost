import PageTitle from "@/components/pageTitle";
import { Switch } from "@/components/ui/switch";
import { useHideEnterpriseNav } from "@/lib/hooks/useHideEnterpriseNav";
import { ENTERPRISE_DEAD_END_NAV_URLS } from "@/lib/enterpriseNav";
import { useLocaleCtx } from "@/lib/i18n/context";

/**
 * 界面偏好：隐藏侧边栏里那些点进去只有企业版升级提示的入口。
 *
 * 这个开关只影响**本地浏览器**（存 localStorage），不改后端配置、不影响 URL 直达、
 * 也不影响企业版构建——企业构建里这些页面是真的，本来就该显示。
 */
export default function InterfacePreferencesView() {
	const { t } = useLocaleCtx();
	const [hideEnterpriseNav, setHideEnterpriseNav] = useHideEnterpriseNav();

	return (
		<div className="mx-auto w-full max-w-4xl space-y-4">
			<PageTitle title={t("Interface")}>
				{t("Preferences for this browser. They are stored locally and do not change server configuration.")}
			</PageTitle>

			<div className="space-y-2 rounded-sm border p-4">
				<div className="flex items-center justify-between space-x-2">
					<div className="space-y-0.5">
						<label htmlFor="hide-enterprise-nav" className="text-sm font-medium">
							{t("Hide enterprise-only navigation")}
						</label>
						<p className="text-muted-foreground text-sm">
							{t("Hide sidebar entries whose pages only show an upgrade notice in this build.")}
						</p>
					</div>
					<Switch
						id="hide-enterprise-nav"
						data-testid="hide-enterprise-nav-switch"
						checked={hideEnterpriseNav}
						onCheckedChange={setHideEnterpriseNav}
					/>
				</div>
				<p className="text-muted-foreground text-xs">
					{t("Affects {count} sidebar entries. Hiding stops them appearing in the menu; visiting their URLs directly still works.", {
						count: ENTERPRISE_DEAD_END_NAV_URLS.size,
					})}
				</p>
			</div>
		</div>
	);
}