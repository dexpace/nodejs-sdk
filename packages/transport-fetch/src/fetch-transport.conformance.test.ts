// SPDX-License-Identifier: MIT
// packages/transport-fetch/src/fetch-transport.conformance.test.ts
// Runs the shared TRANSPORT-N suite (@dexpace/transport-conformance) against fetchTransport().
import {runTransportConformanceSuite} from '@dexpace/transport-conformance';
import {fetchTransport} from './fetch-transport.js';

runTransportConformanceSuite('fetchTransport', () => fetchTransport(), {
  // TRANSPORT-8 scoped out: the global fetch has no internal-cancel path distinct from an abort.
  supportsInternalCancel: false,
  // TRANSPORT-30 scoped out: proxying would mean depending on undici internals (design doc s6).
  supportsProxy: false,
  // TRANSPORT-11: `Connection` is a WHATWG forbidden request header, so fetch drops it either way.
  dropsConnectionHeader: true,
});
