---
"@dexpace/core": minor
---

Remove `DomainModelError` as a class tier. The ten HTTP domain-model error leaves — `RequiredFieldError`, `HeaderValidationError`, `MediaTypeParseError`, `ProtocolParseError`, `UrlConstructionError`, `RequestOptionsValidationError`, `EtagParseError`, `HttpRangeValidationError`, `RequestConditionsValidationError` and `RequestBodyNotAllowedError` — now extend `DexpaceError` directly, and a new `@public` `isDomainModelError` type guard groups them.

**This is a breaking change to published API.** `DomainModelError` was a barrel export and a runtime value, so `instanceof` narrowing on it was live public API, and it is gone. The migration is one line: `if (error instanceof DomainModelError)` becomes `if (isDomainModelError(error))`, which narrows to the same ten-class union, so nothing downstream of the check changes.

The class earned its removal by doing nothing: it was an empty marker (`export class DomainModelError extends DexpaceError {}`), nothing in the SDK ever narrowed on it, and the corpus caps custom error hierarchies at two levels. Core had already stopped feeding it — `HttpStatusValidationError` landed as a two-level leaf under `DexpaceError` rather than as an eleventh leaf on the tier.

**The taxonomy stays mixed, and that is deliberate.** `TransportFailureError extends IoError` is still three levels. `TRANSPORT-20` is a MUST requiring the canonical transport failure to be a subtype of the platform IO exception so existing `catch (IOException)` sites keep matching, and `retry/classify.ts` walks the cause chain with `current instanceof IoError` to make such a failure unconditionally retryable; removing that tier would break a MUST and a live retry path (`docs/deviations.md` item 17). This change removes the one gratuitous three-level tier and leaves the one the specification requires — it does not make the tree uniformly two-level.

Kept as **minor** rather than major because `@dexpace/core` is still pre-1.0 (`0.0.0`), where a 0.x breaking change is conventionally released as minor (semver's own carve-out for initial development, https://semver.org/#spec-item-4). Revisit at 1.0.
