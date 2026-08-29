// SPDX-License-Identifier: MIT
// packages/transport-undici/src/challenge-handler.ts
import {
  getGlobalLogger,
  type LogEvent,
  type ProxyOptions,
  type Response,
} from '@dexpace/core';

/** OBS-20: a logger failure must never fail the request it was describing. */
function safeWarn(event: string, decorate: (entry: LogEvent) => void): void {
  try {
    const entry = getGlobalLogger().atLevel('warning').event(event);
    decorate(entry);
    entry.emit();
  } catch {
    // Deliberately swallowed -- see OBS-20.
  }
}

/** Names the proxy without ever rendering its credentials (TRANSPORT-30, redaction rules). */
function describeProxy(entry: LogEvent, proxy: ProxyOptions): LogEvent {
  return entry.field('proxy.host', proxy.host).field('proxy.port', proxy.port);
}

function hasCustomChallengeHandler(proxy: ProxyOptions | undefined): boolean {
  return proxy !== undefined && typeof proxy.challengeHandler === 'function';
}

/**
 * TRANSPORT-30's discoverability clause, at construction: undici cannot dispatch a custom
 * (non-Basic) proxy challenge handler at all, so a configured one is surfaced with a WARN rather
 * than silently ignored.
 *
 * The reason is a hard constraint of the native client, not a gap in this package: `ProxyAgent`
 * rejects a per-request `Proxy-Authorization` header with `InvalidArgumentError` — it was removed
 * deliberately as a security fix — and takes its credential only from its own constructor, which
 * runs before any challenge has been seen. There is therefore no point at which a handler-minted
 * credential could be applied to the exchange that provoked it. Proxy auth falls back to Basic:
 * `ProxyOptions.credentials`, which this transport does pass to the `ProxyAgent` constructor.
 *
 * @param proxy - the configured proxy, if any.
 *
 * @internal
 */
export function warnIfCustomChallengeHandler(
  proxy: ProxyOptions | undefined,
): void {
  if (proxy === undefined || !hasCustomChallengeHandler(proxy)) return;
  safeWarn('proxy.challengeHandler.unsupported', entry => {
    describeProxy(entry, proxy).field(
      'detail',
      'undici takes proxy credentials only from the ProxyAgent constructor and rejects a ' +
        'per-request Proxy-Authorization header, so a custom challenge handler cannot be ' +
        'dispatched; proxy auth falls back to Basic (ProxyOptions.credentials)',
    );
  });
}

/**
 * Builds the per-transport reporter for TRANSPORT-30's second discoverability moment: the first time
 * a proxy actually answers 407 while an undispatchable challenge handler is configured.
 *
 * Only a 407 is reported. A 401 is an *origin-server* challenge, and nothing about proxy credentials
 * belongs anywhere near it — the spec makes that an explicit MUST NOT, so it is a guard here rather
 * than an accident of control flow. The credential itself is never logged on any path; the 407 is
 * returned to the caller untouched, for its own auth layer to act on.
 *
 * @param proxy - the configured proxy, if any.
 * @returns a reporter to call with each adapted response; warns at most once per transport.
 *
 * @internal
 */
export function createProxyChallengeReporter(
  proxy: ProxyOptions | undefined,
): (response: Response) => void {
  if (proxy === undefined || !hasCustomChallengeHandler(proxy)) {
    return () => undefined;
  }
  let reported = false;
  return (response: Response) => {
    if (response.status.code !== 407 || reported) return;
    reported = true;
    safeWarn('proxy.challenge.unanswered', entry => {
      describeProxy(entry, proxy).field(
        'detail',
        'the proxy issued a 407 and the configured challenge handler cannot be dispatched; ' +
          'the response is surfaced unchanged for the caller’s own auth layer',
      );
    });
  };
}
