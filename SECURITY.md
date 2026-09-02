# Security Policy

## Supported versions

Nothing has shipped yet: every package in the workspace is at `0.0.0` and
none has been published to npm, so there is no released version to support
and no patched release to point at. Until the first release, the supported
revision is the tip of `mvp` — report against a commit SHA.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately by email to
[oaljarrah@dexpace.org](mailto:oaljarrah@dexpace.org) with `[SECURITY]` in
the subject line.

Include what you can of the following:

- The affected package(s), and the commit SHA and Bun/Node.js versions you
  reproduced against
- A description of the vulnerability and its impact
- Steps or a proof of concept to reproduce it

You can expect an acknowledgement within a few days. Please allow time for
a fix to land and be released before disclosing publicly.

## Scope notes

- The SDK is a **toolkit**, not a service: `@dexpace/core` executes no
  network I/O of its own, and reaches into `node:` exactly once, for
  `AsyncLocalStorage`. Transport-level vulnerabilities (TLS, connection
  handling, message parsing) belong to whatever sits behind the `Transport`
  seam — the runtime's global `fetch`, or `undici` for
  `@dexpace/transport-undici` — report those upstream.
- In scope here: credential handling and challenge parsing
  (`packages/core/src/auth/`), header/URL redaction in logging
  (`packages/core/src/observability/redaction.ts`), redirect safety
  (`Authorization` stripped on every re-issue, `Cookie` and
  `Proxy-Authorization` cross-origin — `packages/core/src/redirect/decide.ts`),
  and body capture (`packages/core/src/body/`, `@dexpace/body-file`).
