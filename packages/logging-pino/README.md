# @dexpace/logging-pino

Routes the dexpace SDK's structured log events into [pino](https://getpino.io). Zero runtime
dependencies: `@dexpace/core` and `pino` are both peers, and `pino` is an **optional** one — this
package only ever calls a duck-typed subset of it.

```sh
bun add @dexpace/logging-pino @dexpace/core pino
```

```typescript
import pino from 'pino';
import {setGlobalLogger} from '@dexpace/core';
import {createPinoLogger} from '@dexpace/logging-pino';

setGlobalLogger(createPinoLogger(pino({level: 'info'})));
```

That is the whole wiring. Every SDK event — retry attempts, redirect hops, dropped outbound headers,
auth refresh failures — now arrives as a pino record with its fields as top-level keys.

## What it actually does

The SDK's `Logger` is a fluent, four-level facade (`atLevel(level).event(name).field(k, v).emit()`).
pino's is a five-method object taking `(obj, msg?)`. This package is the mapping between them, and
it is three decisions wide:

| SDK level | pino method |
|---|---|
| `error` | `error` |
| `warning` | `warn` |
| `info` | `info` |
| `verbose` | `debug` |

- **Fields become the record, not the message.** Each event's field map is passed as pino's `obj`
  argument, so `{event: 'http.retry.attemptFailed', attempt: 2}` lands as queryable keys rather than
  an interpolated string. No `msg` is set.
- **Level checks are delegated, per call.** `isLevelEnabled` is wired straight to
  `pino.isLevelEnabled`, so a suppressed event costs one predicate call and never builds its field
  map. Changing pino's level at runtime takes effect immediately; nothing is cached.
- **`pino.trace` is never called.** The SDK has four levels; `verbose` is the floor and maps to
  `debug`.

## Options

`createPinoLogger(instance, options)` forwards `CreateLoggerOptions` minus `isLevelEnabled`, which
this adapter owns:

- `globalFields` — merged into every record (a service name, a build id).
- `diagnosticAllowList` — the query parameters that survive URL redaction. Everything else is
  redacted before it reaches pino, so a URL in a log line cannot leak a token. `null` means "redact
  every parameter".

## Anything pino-shaped works

The parameter type is `PinoLike`, a five-method structural interface — `isLevelEnabled`, `error`,
`warn`, `info`, `debug` — not pino's own type. A real pino instance duck-types into it, and so does a
child logger (`pino().child({req: id})`), a test double, or a wrapper of your own. That is why this
package can declare `pino` optional and still carry zero dependencies.

A non-object, or an object without a callable `isLevelEnabled`, is a construction-time `TypeError` —
loud, at wiring time, rather than a swallowed no-op at the first log line.

## The alternative

`@dexpace/logging-debug` does the same job over [`debug`](https://www.npmjs.com/package/debug), with
namespace-per-level filtering instead of a level threshold. Neither is required: the SDK's default
is `NOOP_LOGGER`, and `createLogger(sink)` in `@dexpace/core` adapts anything else in a few lines.
