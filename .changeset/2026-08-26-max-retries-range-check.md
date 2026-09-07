---
"@dexpace/core": patch
---

Tighten `RequestOptionsBuilder.maxRetries` validation: a defined value must now be a non-negative
integer. `Infinity`, `NaN`, and fractional values were previously accepted and now throw
`RequestOptionsValidationError`, the same way a negative value already did.

A retry ceiling is a count of wire sends, so a non-finite one is as out of range as a negative one —
and worse in effect: a negative value still fails a downstream `>= 1` guard, while `Infinity` or
`NaN` makes a retry driver's `attempt >= ceiling` test permanently false and its loop unbounded.
HTTP-35's requirement is that an out-of-range retry count is a loud error at the call site that
supplied it, never a value reinterpreted somewhere downstream; this closes the half of that
requirement the setter did not implement.
