// SPDX-License-Identifier: MIT
// packages/transport-undici/src/undici-transport.conformance.test.ts
// Runs the shared TRANSPORT-N suite (@dexpace/transport-conformance) against undiciTransport().
import {createProxyOptions} from '@dexpace/core';
import {runTransportConformanceSuite} from '@dexpace/transport-conformance';
import {undiciTransport} from './undici-transport.js';

runTransportConformanceSuite('undiciTransport', () => undiciTransport(), {
  supportsInternalCancel: true,
  supportsProxy: true,
  // TRANSPORT-11's own note: an undici-class transport forwards `Connection` rather than dropping it.
  dropsConnectionHeader: false,
  // TRANSPORT-30: core resolves `ALL_PROXY=socks5://host:1080` to this type (CFG-22), and undici's
  // `ProxyAgent` is an HTTP CONNECT tunnel that cannot carry it.
  // HTTP-35: the factory is where a default `AbortSignal.timeout()` could not take is refused.
  buildWithDefaultTimeoutMs: value =>
    undiciTransport({defaultTimeoutMs: value}),
  unsupportedProxy: {
    type: 'socks5',
    build: () =>
      undiciTransport({
        proxy: createProxyOptions({
          type: 'socks5',
          host: '127.0.0.1',
          port: 1080,
        }),
      }),
  },
});
