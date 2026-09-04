# function-design — notes

Hand-written. `docs/knowledge/harvested/function-design.md` is what the styleguide says; this file
records how this repository resolved a conflict inside it, and it wins. Each entry names the
harvested entry it answers by that entry's stable key.

## Conflicts
- **The parameter-count threshold this repository enforces is the lint threshold, not the prose one: three positional parameters are allowed, four are an error.** Bounds `function-design/45a4ddba` ("a function must take an options object when it has 3 or more parameters") with `function-design/27da9d1f` ("positional parameters are capped by ESLint `max-params: ['error', 3]`"). The two are one parameter apart — the prose bans three, the enforcement bans four — and nothing in the corpus's `--section conflicts` reconciles them, which is why the Phase 4b validation review filed a row against the prose on 2026-07-28 and left it unowned.

  **Measured 2026-09-04: the repository follows the lint threshold, and has throughout.** `eslint.config.js` sets `max-params` to 3, so a three-parameter function is legal, and three-parameter functions ship across every subsystem — `Transport.send(request, options?, signal?)`, `fold(outcome, onSuccess, onFailure)`, `Deserializer.deserializeFrom(source, schema, typeName?)`, `redactHeaderValue(name, value, policy?)`. Where a fourth was genuinely wanted the code carries a documented `eslint-disable-next-line max-params` with a stated reason, which is the gate being *enforced* rather than evaded — the model builders' private constructors are the standing example.

  **Why the lint threshold wins, rather than the prose.** The boolean half of the prose rule is unaffected and still binds: any boolean parameter forces an options object regardless of count, and the control-flag conclusion at `docs/knowledge/harvested/function-design.md:44` sharpens it further. What is bounded is only the numeric threshold, and there the enforceable rule is the one a reviewer and a gate can agree on. A prose rule one notch stricter than its own enforcement produces exactly this: a repository that complies with the gate, a corpus that reads as if it does not, and a review that has to re-derive the answer every time. `docs/knowledge/harvested/api-design.md:14` states the neighbouring rule for *optional* parameters — collect them into an options object past two — and that one is followed independently; `DecodeTarget<T>` exists because of it.
  <sub>review · `eslint.config.js` · high · sha:manual-2026-09-04-max-params-threshold</sub>
