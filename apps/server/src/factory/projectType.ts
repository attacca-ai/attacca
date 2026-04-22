import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectType } from "@t3tools/contracts";

const BROWNFIELD_MARKERS = [
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
] as const;

export function detectProjectType(projectPath: string): ProjectType {
  return BROWNFIELD_MARKERS.some((marker) => existsSync(join(projectPath, marker)))
    ? "brownfield"
    : "greenfield";
}
