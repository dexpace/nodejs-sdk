# @dexpace/logging-debug

Debug logging adapter for the dexpace Node.js SDK.

## Installation

```bash
npm install @dexpace/logging-debug debug
```

## Usage

```typescript
import debug from 'debug';
import {createDebugLogger} from '@dexpace/logging-debug';
import {setGlobalLogger} from '@dexpace/core';

// Wrap debug factory:
setGlobalLogger(createDebugLogger(debug, 'dexpace'));
```
