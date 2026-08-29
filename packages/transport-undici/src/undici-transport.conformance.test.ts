// SPDX-License-Identifier: MIT
// packages/transport-undici/src/undici-transport.conformance.test.ts
// Runs the shared TRANSPORT-N suite (@dexpace/transport-conformance) against undiciTransport().
import {runTransportConformanceSuite} from '@dexpace/transport-conformance';
import {undiciTransport} from './undici-transport.js';

runTransportConformanceSuite('undiciTransport', () => undiciTransport(), {
  supportsInternalCancel: true,
  supportsProxy: true,
  // TRANSPORT-11's own note: an undici-class transport forwards `Connection` rather than dropping it.
  dropsConnectionHeader: false,
});
