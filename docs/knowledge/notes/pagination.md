# pagination — notes

Hand-written. `docs/knowledge/harvested/pagination.md` is what the documents say; this file is what
the implementation found, and it wins. Each entry names the harvested entry it answers by that
entry's stable key.

## Superseded
- **Item-view close ordering: `PAGE-11` governs, and the `sdk-design-nodejs/07` §7.1 snippet does not.** Supersedes `pagination/81881061` (the Reference entry describing the snippet) and resolves the conflict statement `pagination/d108714e`. The item-level view copies the page's items, closes the page, and only then yields — never the snippet's `yield*` inside a `try` with `close()` in the `finally`. The standing tie-breaker applies: a normative MUST beats an illustrative snippet, and the cost is zero because `PAGE-2` guarantees materialized items survive close. Phase 6c implements copy-items → close → yield and wrote the erratum into `sdk-design-nodejs/07` §7.1.

  The reason this needed recording rather than silently correcting: **the conformance test is weaker than the requirement.** Appendix B's `PAGE-11` check ("take one item from a multi-item first page and stop; assert the first page's response was closed") *passes* under the snippet's ordering, because an early `break` drives `.return()` and therefore the `finally`. Following the design doc would have shipped a MUST violation the checklist could not catch. Phase 6c's `lifecycle.test.ts` adds the assertion appendix B does not make — that the close is observed *before* the first item is yielded.
  <sub>review · `docs/superpowers/specs/2026-07-28-phase6c-pagination-design.md` · high · sha:manual-6c-erratum</sub>
