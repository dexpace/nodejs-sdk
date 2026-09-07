# deliberate-deviations — notes

Hand-written. There is no harvested counterpart to this file, deliberately: see the entry below.

## Reference
- **The deviation register is not harvested. Read the register itself, at the start of every phase.** `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` is a numbered ledger that each phase appends to, and a harvest of a ledger is a snapshot of one revision that goes stale on the next append. The snapshot this corpus used to carry proved the point: 13 entries against a 17-item register, roughly a third of it, mis-anchored, two entries substantively false, and pinned to a sha three revisions old. A description of an approach is harvestable because it changes slowly; a register is not. `docs/deviations.md` is the as-built audit of that same ledger, and `docs/open-items.md` is the second register under the same rule — read them, do not expect `bun run knowledge` to know them.
  <sub>review · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` · high · sha:manual-register-pointer</sub>
