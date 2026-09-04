---
"@dexpace/core": patch
---

Delete `packages/core/src/seams/index.ts`, an internal folder-level barrel from Phase 2 that nothing
imported. Its only reference anywhere in the workspace was the comment in `packages/core/src/index.ts`
explaining why the public barrel deliberately did not re-export it.

No published surface changes: `packages/core/package.json`'s `exports` names `.` only, so the file
was never reachable by a consumer, and every symbol it re-exported is already named directly on the
public barrel. Closes `docs/open-items.md` H12.
