import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { buildClaudeCodeCommand } from "../commandBuilders";
import { HarnessCommandSection } from "../harnessCommandSection";
import type { ClaudeScope, HarnessInstallProps } from "../types";
import { getRegistrationLabel } from "../utils";
import { useLocaleCtx } from "@/lib/i18n/context";

export function ClaudeCodeHarnessInstall({
	canGenerateCommand,
	clientConfig,
	emptyMessage,
	headers,
	selectedServers,
	serverScope,
}: HarnessInstallProps) {
	const { t } = useLocaleCtx();
	const [scope, setScope] = useState<ClaudeScope>("local");

	const command = useMemo(
		() =>
			buildClaudeCodeCommand({
				clientConfig,
				headers,
				scope,
				selectedServers: serverScope === "selected" ? selectedServers : undefined,
			}),
		[clientConfig, headers, scope, selectedServers, serverScope],
	);

	return (
		<HarnessCommandSection
			canCopyCommand={canGenerateCommand}
			command={command}
			controls={
				<Select value={scope} onValueChange={(value) => setScope(value as ClaudeScope)}>
					<SelectTrigger className="w-32" data-testid="mcp-usage-guide-claude-scope" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="local">{t("Local")}</SelectItem>
						<SelectItem value="project">{t("Project")}</SelectItem>
						<SelectItem value="user">{t("User")}</SelectItem>
					</SelectContent>
				</Select>
			}
			emptyMessage={emptyMessage}
			harnessName="Claude Code"
			logoSrc="/images/harness/claudecode.svg"
			registrationLabel={getRegistrationLabel(serverScope, selectedServers)}
		/>
	);
}