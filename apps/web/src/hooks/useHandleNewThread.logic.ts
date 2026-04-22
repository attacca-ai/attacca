export interface ApplyPresetPromptIfBlankOptions<TTarget> {
  readonly target: TTarget;
  readonly presetPrompt: string | null | undefined;
  readonly getPrompt: (target: TTarget) => string | null | undefined;
  readonly setPrompt: (target: TTarget, prompt: string) => void;
}

export function isBlankPrompt(prompt: string | null | undefined): boolean {
  return !prompt || prompt.trim().length === 0;
}

export function applyPresetPromptIfBlank<TTarget>({
  target,
  presetPrompt,
  getPrompt,
  setPrompt,
}: ApplyPresetPromptIfBlankOptions<TTarget>): boolean {
  if (!presetPrompt || !isBlankPrompt(getPrompt(target))) {
    return false;
  }
  setPrompt(target, presetPrompt);
  return true;
}
