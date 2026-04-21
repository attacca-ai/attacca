import { describe, expect, it, vi } from "vitest";

import { applyPresetPromptIfBlank, isBlankPrompt } from "./useHandleNewThread.logic";

describe("useHandleNewThread.logic", () => {
  it("treats missing and whitespace-only prompts as blank", () => {
    expect(isBlankPrompt(undefined)).toBe(true);
    expect(isBlankPrompt(null)).toBe(true);
    expect(isBlankPrompt("")).toBe(true);
    expect(isBlankPrompt("   \n\t")).toBe(true);
    expect(isBlankPrompt("hello")).toBe(false);
  });

  it("seeds the preset prompt when the current draft is blank", () => {
    const setPrompt = vi.fn<(target: string, prompt: string) => void>();

    const applied = applyPresetPromptIfBlank({
      target: "draft-1",
      presetPrompt: "Write the missing spec.",
      getPrompt: () => "   ",
      setPrompt,
    });

    expect(applied).toBe(true);
    expect(setPrompt).toHaveBeenCalledWith("draft-1", "Write the missing spec.");
  });

  it("does not overwrite an existing non-blank draft prompt", () => {
    const setPrompt = vi.fn<(target: string, prompt: string) => void>();

    const applied = applyPresetPromptIfBlank({
      target: "draft-1",
      presetPrompt: "Write the missing spec.",
      getPrompt: () => "Existing draft text",
      setPrompt,
    });

    expect(applied).toBe(false);
    expect(setPrompt).not.toHaveBeenCalled();
  });
});
