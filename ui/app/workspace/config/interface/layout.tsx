import { createFileRoute } from "@tanstack/react-router";
import InterfacePreferencesPage from "./page";

export const Route = createFileRoute("/workspace/config/interface")({
	component: InterfacePreferencesPage,
});