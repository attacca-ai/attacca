/**
 * Forge skills loader.
 *
 * Reads the SKILL.md files shipped with the `attacca-forge` npm package.
 * Each skill has YAML frontmatter with `name` and `description` keys — the
 * description may be a folded block scalar (`description: >`). We only need
 * those two fields plus the directory path, so a minimal parser is enough.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import type { ForgeSkill, ForgeSkillListResult } from "@t3tools/contracts";

const requireFromServer = createRequire(import.meta.url);

let cachedSkillsDir: string | null = null;

function resolveSkillsDir(): string {
  if (cachedSkillsDir) return cachedSkillsDir;
  const pkgJsonPath = requireFromServer.resolve("attacca-forge/package.json");
  cachedSkillsDir = join(dirname(pkgJsonPath), "skills");
  return cachedSkillsDir;
}

interface ParsedFrontmatter {
  readonly name: string | null;
  readonly description: string | null;
}

/**
 * Parses the YAML frontmatter of a SKILL.md file. Only extracts `name` and
 * `description`, and supports both inline (`description: text`) and folded
 * block scalar (`description: >` followed by indented lines) forms.
 */
function parseSkillFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { name: null, description: null };
  }

  let name: string | null = null;
  let description: string | null = null;

  let i = 1;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") break;

    const colon = line.indexOf(":");
    if (colon === -1) {
      i += 1;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();

    if (key === "name") {
      name = rawValue.replace(/^["']|["']$/g, "") || null;
      i += 1;
      continue;
    }

    if (key === "description") {
      if (rawValue === ">" || rawValue === "|" || rawValue === "") {
        // Folded / literal block scalar: collect indented lines until unindent.
        const collected: string[] = [];
        i += 1;
        while (i < lines.length) {
          const next = lines[i] ?? "";
          if (next.trim() === "---") break;
          if (next.length === 0) {
            collected.push("");
            i += 1;
            continue;
          }
          if (!/^\s/.test(next)) break;
          collected.push(next.trim());
          i += 1;
        }
        description = collected.join(" ").replace(/\s+/g, " ").trim() || null;
        continue;
      }
      description = rawValue.replace(/^["']|["']$/g, "") || null;
      i += 1;
      continue;
    }

    i += 1;
  }

  return { name, description };
}

export function loadForgeSkills(): ForgeSkillListResult {
  const skillsDir = resolveSkillsDir();
  if (!existsSync(skillsDir)) {
    return { skills: [], source: skillsDir };
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skills: ForgeSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(skillsDir, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    try {
      const content = readFileSync(skillFile, "utf-8");
      const { name, description } = parseSkillFrontmatter(content);
      skills.push({
        name: name ?? entry.name,
        description: description ?? "",
        path: skillDir,
      });
    } catch {
      // Skip unreadable skill files rather than fail the entire list.
      continue;
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, source: skillsDir };
}
