// SPDX-License-Identifier: MIT
// packages/transport-shared/src/index.ts
export {abortToSdkError} from './abort-mapping.js';
export {
  isMaterializable,
  materializeBody,
  producerFailure,
  pumpBody,
  type BodyPump,
} from './body-pump.js';
export {
  isPermanentDispatchFailure,
  toDispatchFailure,
} from './dispatch-classification.js';
export {createDropLogger, type HeaderDropLogging} from './drop-log.js';
export {
  degradeInboundHeaders,
  mapOutboundHeaders,
  type MapOutboundHeadersOptions,
} from './header-mapping.js';
export {forkSignal, type ForkedSignal} from './signal-fork.js';
