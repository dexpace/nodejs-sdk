# @dexpace/rx

RxJS async-runtime bridge for the dexpace Node.js SDK.

## Installation

```bash
npm install @dexpace/rx rxjs
```

## Usage

```typescript
import {sseEvents$, typedSse$, pageItems$, pages$} from '@dexpace/rx';
import {sseStreamFrom, Paginator} from '@dexpace/core';

// Server-Sent Events
sseEvents$(sseStreamFrom(response)).subscribe({
  next: event => console.log(event.data),
});

// ...or decoded into your own models
typedSse$(sseStreamFrom(response), (eventName, data) =>
  eventName === 'done'
    ? {kind: 'done'}
    : {kind: 'value', value: JSON.parse(data)},
).subscribe({next: model => console.log(model)});

// Pagination, item by item or page by page
pageItems$(paginator).subscribe({next: item => console.log(item)});
pages$(paginator).subscribe({next: page => console.log(page.items)});
```

## Two subscription models, on purpose

`sseEvents$`/`typedSse$` are **single-subscription**. An `SseStream` wraps one already-open HTTP response body,
which is single-use (`BODY-14`) and single-pass (`SSE-26`); there is no honest way to make re-subscription
meaningful without a second HTTP call this package does not make. A second `subscribe()` reaches `SseStream`'s
own guard and surfaces its error through the `Observable`'s error channel.

`pageItems$`/`pages$` are **cold and repeatable**. `Paginator.items()`/`.pages()` build a fresh generator per
call (`PAGE-8`), so each subscription drives an independent fetch sequence.

Both release their source on `unsubscribe()`, including while idle — an SSE stream waiting on the next event is
closed immediately rather than when the server next sends something.

## Notes

- `rxjs` and `@dexpace/core` are **peer** dependencies. A duplicate copy of either would break the identity
  checks (`Observable`/`Subscription`, and core's branded symbols) that a bundled copy silently defeats.
- This package installs no RxJS scheduler. Diagnostic context therefore propagates on its own through Node's
  `AsyncLocalStorage`; a caller who adds `observeOn`/`subscribeOn` downstream owns reinstating it.
