import { createFileRoute } from "@tanstack/react-router";

import { StandSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/stand")({
  component: StandSettingsPanel,
});
