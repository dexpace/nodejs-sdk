---
"@dexpace/core": minor
---

Publish `clientIdentityStep` and `ClientIdentitySettings` on the package barrel (RECOV-33, NFR-15).
Purely additive: `packages/core/etc/core.api.md` gains ten lines and loses none, and the step's
behavior, defaults and error paths are unchanged.

`RECOV-33`'s identity-stamping step has been implemented and tested since Phase 7a, and unreachable
for just as long — tagged `@internal`, absent from the barrel, and installed by nothing.
`standardResilience` does not install it, so the step's own TSDoc instruction ("a caller adds it to
their own pipeline") named an action no caller could take. Every other step factory was already
public: `authStep`, `retryStep`, `redirectStep`, `loggingStep`, `stripCrossOriginMarkerStep`.

The blocker that kept it internal is gone and had been for two phases. The barrel comment claimed
its `StepDescriptor` return type was "part of the still-internal pipeline authoring surface", which
stopped being true when Phase 5c promoted `StepDescriptor`, `Stage`, `Step`, `StepContext` and
`PipelineBuilder`. Exporting the step therefore names no forgotten export, and api-extractor accepts
it unchanged.

Its file stays at `packages/core/src/config/client-identity-step.ts`. A `@public` symbol named on the
barrel against its own module path has an invisible folder, and relocating it to `recovery/` would
trade its one outbound `→ pipeline/` edge for a new `→ config/` one for `./build-info.js`.

Usage:

```ts
import {clientIdentityStep, PipelineBuilder} from '@dexpace/core';

const runtime = new PipelineBuilder(transport)
  .append(clientIdentityStep({tokens: ['acme-sdk/1.2.3'], mode: 'append'}))
  .build();
```

See `docs/work/mvp/2026-09-04-open-items-dissolution.md` K1 (fixed) and K11 (closed).
