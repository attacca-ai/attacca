import { Effect } from "effect";
import type { GitCloneRepositoryInput, GitCloneRepositoryResult } from "@t3tools/contracts";
import type { FactoryPathError, GitCommandError } from "@t3tools/contracts";

import { assertPathInsideAllowedRoot } from "../factory/allowedRoots";
import { GitCore } from "./Services/GitCore";

export const cloneRepositoryEffect = (
  input: GitCloneRepositoryInput,
): Effect.Effect<GitCloneRepositoryResult, FactoryPathError | GitCommandError, GitCore> =>
  Effect.gen(function* () {
    assertPathInsideAllowedRoot(input.destinationParent, input.allowedRoots);
    const git = yield* GitCore;
    return yield* git.cloneRepository(input);
  });
