# @dexpace/logging-debug

Routes the dexpace SDK's structured log events into [`debug`](https://www.npmjs.com/package/debug).
Zero runtime dependencies: `@dexpace/core` and `debug` are both peers, and `debug` is an **optional**
one — this package only ever calls a duck-typed subset of it.

```sh
bun add @dexpace/logging-debug @dexpace/core debug
```

```typescript
import debug from 'debug';
import {setGlobalLogger} from '@dexpace/core';
import {createDebugLogger} from '@dexpace/logging-debug';

setGlobalLogger(createDebugLogger(debug, 'dexpace'));
```

```sh
DEBUG='dexpace:*' node app.js        # everything
DEBUG='dexpace:error,dexpace:warning' node app.js   # just the loud levels
```

## One namespace per level

Pass `debug` itself — the **factory** — and this adapter calls it once per level, lazily, and caches
the result: `dexpace:error`, `dexpace:warning`, `dexpace:info`, `dexpace:verbose`. That is the whole
design, and it is what makes `DEBUG` a level filter without `debug` having levels. Change the base
namespace with the second argument; it defaults to `dexpace`.

Pass a single **debugger** instead — `createDebugLogger(debug('myapp'))` — and every level goes to
that one namespace. The adapter tells the two apart structurally, by whether the argument has a
boolean `enabled` property, so there is no mode flag to get wrong.

## What a record looks like

The SDK's `Logger` is fluent and field-oriented (`atLevel(level).event(name).field(k, v).emit()`);
`debug` takes a format string. Each event's field map is flattened to `key=value` pairs joined by
spaces and emitted through `%s`:

```
dexpace:warning event=http.transport.headerDropped name=content-length +0ms
```

Values go through `String(v)`, so this is a human-readable channel, not a machine-parseable one. If
you need to query your logs, use `@dexpace/logging-pino`, which passes the field map to pino as an
object.

**Suppressed events cost nothing.** `isLevelEnabled` is wired to that level's `debugger.enabled`,
which `debug` computes from `DEBUG` at construction — so an event at a disabled level never builds
its field map.

## Options

`createDebugLogger(debugOrFactory, namespace, options)` forwards `CreateLoggerOptions` minus
`isLevelEnabled`, which this adapter owns:

- `globalFields` — merged into every record.
- `diagnosticAllowList` — the query parameters that survive URL redaction. Everything else is
  redacted before it reaches `debug`, so a URL in a log line cannot leak a token. `null` means
  "redact every parameter".

A `null`, or anything that is neither a function nor an object, is a construction-time `TypeError` —
loud, at wiring time, rather than a swallowed no-op at the first log line.

## The alternative

`@dexpace/logging-pino` does the same job over pino, with structured records and a runtime-adjustable
level. Neither is required: the SDK's default is `NOOP_LOGGER`, and `createLogger(sink)` in
`@dexpace/core` adapts anything else in a few lines.
