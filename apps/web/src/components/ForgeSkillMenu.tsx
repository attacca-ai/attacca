import { memo, useEffect, useMemo, useState } from "react";
import type { ForgeSkill } from "@t3tools/contracts";
import { HammerIcon, LoaderIcon, SearchIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";
import { useFactoryStore } from "../stores/factory";

interface ForgeSkillMenuProps {
  readonly currentPrompt: string;
  readonly onInsertSkill: (nextPrompt: string) => void;
  readonly disabled?: boolean;
}

function buildNextPrompt(currentPrompt: string, skillName: string): string {
  const invocation = `/attacca-forge:${skillName} `;
  if (currentPrompt.length === 0) {
    return invocation;
  }
  const needsNewline = !currentPrompt.endsWith("\n");
  return `${currentPrompt}${needsNewline ? "\n" : ""}${invocation}`;
}

function filterSkills(skills: ReadonlyArray<ForgeSkill>, query: string): ReadonlyArray<ForgeSkill> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(trimmed) ||
      skill.description.toLowerCase().includes(trimmed),
  );
}

const ForgeSkillMenu = memo(function ForgeSkillMenu({
  currentPrompt,
  onInsertSkill,
  disabled = false,
}: ForgeSkillMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const forgeSkills = useFactoryStore((state) => state.forgeSkills);
  const loadForgeSkills = useFactoryStore((state) => state.loadForgeSkills);

  useEffect(() => {
    if (!open) return;
    if (forgeSkills.status === "idle" || forgeSkills.status === "error") {
      void loadForgeSkills();
    }
  }, [open, forgeSkills.status, loadForgeSkills]);

  const filtered = useMemo(
    () => filterSkills(forgeSkills.skills, query),
    [forgeSkills.skills, query],
  );

  const handleSelect = (skill: ForgeSkill) => {
    onInsertSkill(buildNextPrompt(currentPrompt, skill.name));
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className={cn(
              "shrink-0 whitespace-nowrap px-2 sm:px-3",
              open
                ? "text-amber-400 hover:text-amber-300"
                : "text-muted-foreground/70 hover:text-foreground/80",
            )}
            size="sm"
            type="button"
            disabled={disabled}
            title="Insert Forge skill"
            aria-label="Insert Forge skill"
          />
        }
      >
        <HammerIcon />
        <span className="sr-only sm:not-sr-only">Skills</span>
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-[380px] p-0">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Forge skills..."
            className="h-7 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
          />
          {forgeSkills.status === "loading" ? (
            <LoaderIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground/50" />
          ) : null}
        </div>
        <ScrollArea className="max-h-[340px]">
          <div className="p-1">
            {forgeSkills.status === "error" ? (
              <p className="px-2 py-3 text-[12px] text-red-400">
                {forgeSkills.error ?? "Failed to load Forge skills."}
              </p>
            ) : filtered.length === 0 && forgeSkills.status !== "loading" ? (
              <p className="px-2 py-3 text-[12px] text-muted-foreground/50">
                {forgeSkills.skills.length === 0
                  ? "No Forge skills installed."
                  : "No skills match your search."}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((skill) => (
                  <li key={skill.name}>
                    <button
                      type="button"
                      onClick={() => handleSelect(skill)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
                    >
                      <span className="text-[13px] font-medium text-foreground/90">
                        {skill.name}
                      </span>
                      {skill.description ? (
                        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground/70">
                          {skill.description}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </PopoverPopup>
    </Popover>
  );
});

export default ForgeSkillMenu;
export type { ForgeSkillMenuProps };
