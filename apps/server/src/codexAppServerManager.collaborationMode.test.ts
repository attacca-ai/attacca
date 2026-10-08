import { describe, expect, it } from "vitest";

import {
  buildCodexCollaborationMode,
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "./codexAppServerManager";

describe("buildCodexCollaborationMode", () => {
  it("returns undefined when no interactionMode is provided", () => {
    expect(buildCodexCollaborationMode({})).toBeUndefined();
  });

  it("emits the default mode instructions when interactionMode is 'default'", () => {
    const result = buildCodexCollaborationMode({ interactionMode: "default" });

    expect(result).toBeDefined();
    expect(result?.mode).toBe("default");
    expect(result?.settings.developer_instructions).toBe(
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
    );
  });

  it("emits the plan mode instructions when interactionMode is 'plan'", () => {
    const result = buildCodexCollaborationMode({ interactionMode: "plan" });

    expect(result).toBeDefined();
    expect(result?.settings.developer_instructions).toBe(
      CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
    );
  });

  it("prefers customDeveloperInstructions over the plan-mode default", () => {
    const custom = "# Arco system prompt\n\nBe terse.\n";

    const result = buildCodexCollaborationMode({
      interactionMode: "plan",
      customDeveloperInstructions: custom,
    });

    expect(result?.settings.developer_instructions).toBe(custom);
  });

  it("prefers customDeveloperInstructions over the default-mode default", () => {
    const custom = "# Arco system prompt\n\nBe terse.\n";

    const result = buildCodexCollaborationMode({
      interactionMode: "default",
      customDeveloperInstructions: custom,
    });

    expect(result?.settings.developer_instructions).toBe(custom);
  });

  it("honors an explicit empty customDeveloperInstructions override", () => {
    const result = buildCodexCollaborationMode({
      interactionMode: "default",
      customDeveloperInstructions: "",
    });

    expect(result?.settings.developer_instructions).toBe("");
  });

  it("falls back to the built-in default when customDeveloperInstructions is undefined", () => {
    const result = buildCodexCollaborationMode({
      interactionMode: "default",
    });

    expect(result?.settings.developer_instructions).toBe(
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
    );
  });

  it("threads the reasoning effort and model normalization through", () => {
    const result = buildCodexCollaborationMode({
      interactionMode: "default",
      model: "gpt-5.4",
      effort: "low",
    });

    expect(result?.settings.model).toBe("gpt-5.4");
    expect(result?.settings.reasoning_effort).toBe("low");
  });
});
