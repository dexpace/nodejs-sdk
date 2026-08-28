# @dexpace/logging-pino

Pino logging adapter for the dexpace Node.js SDK.

## Installation

```bash
npm install @dexpace/logging-pino pino
```

## Usage

```typescript
import pino from 'pino';
import {createPinoLogger} from '@dexpace/logging-pino';
import {setGlobalLogger} from '@dexpace/core';

const loggerInstance = pino({level: 'info'});
setGlobalLogger(createPinoLogger(loggerInstance));
```
