---
"@dexpace/core": patch
---

Three configuration and auth failures that resolved silently now emit a structured warning through
`getGlobalLogger()`. All three were deferred to "once a `Logger` seam exists"; Phase 7b shipped one,
and these are the call sites that never got wired to it.

- **`AUTH-37`** — a failed background bearer-token refresh emits `http.auth.bearerRefreshFailed` with
  the provider's error as the cause, then continues exactly as before. The requirement is
  log-and-continue; only the continue half was implemented.
- **`CFG-24`** — a proxy URL rejected by `resolveProxyOptions` emits `http.proxy.configRejected`
  naming the variable it came from (`HTTPS_PROXY`/`HTTP_PROXY`) and which gate rejected it
  (`unparseable`, `scheme`, `port`, `host`). A typo'd proxy variable previously routed every request
  direct with nothing to read anywhere. The URL itself is never logged — it can carry `user:pass@`,
  and CFG-22 masks credentials in every rendering.
- **`CFG-5`/`CFG-11`** — a caller-supplied configuration source that throws emits
  `config.sourceFailed` naming the layer and the key. The lookup still falls through to the caller's
  default, because CFG-5's never-throw clause is the stronger obligation; what changes is that the
  operator can now see why.

Resolution behaviour is unchanged in all three cases. Every emission is wrapped so a failing logger
cannot fail the operation (OBS-20).
