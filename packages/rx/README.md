# @dexpace/rx

RxJS async-runtime bridge for the dexpace Node.js SDK.

## Installation

```bash
npm install @dexpace/rx rxjs
```

## Usage

```typescript
import {sseEvents$, typedSse$, pageItems$, pages$} from '@dexpace/rx';
import {sseStreamFrom, Paginator, type Response} from '@dexpace/core';

declare const response: Response;
declare const paginator: Paginator<unknown>;

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
closed immediately rather than when the server next sends something. Which of the two *owns* that source
differs, and that is the next section.

## Who owns the stream

`sseEvents$`/`typedSse$` **take ownership of the `SseStream` you hand them.** Subscribing takes the stream's one
iterator (`SSE-26`), and the adapter releases the stream on every termination — `unsubscribe()`, end-of-source
and a source error alike. Do not call `close()` on it yourself, and do not iterate it afterwards; `unsubscribe()`
is how you stop early.

That covers stopping while the stream is **idle**, which is where a live event stream spends almost all of its
time. The adapter runs the release *ahead of* the iterator's `return()` on purpose: an async generator's
`return()` queues behind a suspended `next()`, so on its own it cannot settle a read that is waiting on a server
which will never send again.

It is also what a plain `for await` over the same stream already does — `SseStream` releases its resource when
its iterator returns, so `break`ing out of the loop closes the response body too. The reactive form transfers
ownership for the same reason the loop does, not as an extra:

```typescript
import {sseStreamFrom, type Response} from '@dexpace/core';

declare const response: Response;

// No `close()` here either: leaving the loop releases the response body.
for await (const event of sseStreamFrom(response)) {
  if (event.event === 'done') break;
}
```

This is a deliberate departure from `ASYNC-21`'s "MUST NOT close the caller-owned source on any termination"
clause, and it is recorded as one — see the `ASYNC-21` row of [`docs/deviations.md`](../../docs/deviations.md).

`pageItems$`/`pages$` transfer nothing, and attach no release callback. The `Paginator`'s own walk already owns
each page's response — `items()` closes a page before yielding any of its items (`PAGE-11`), and `pages()`
closes the held page from the generator's `finally` (`PAGE-12`), which the iterator's `return()` drives. That is
enough there because a paginator's pulls are bounded HTTP exchanges; an SSE pull is a wait on a server that may
never answer, which is the difference the callback exists for.

## Notes

- `rxjs` and `@dexpace/core` are **peer** dependencies. A duplicate copy of either would break the identity
  checks (`Observable`/`Subscription`, and core's branded symbols) that a bundled copy silently defeats.
- This package installs no RxJS scheduler. Diagnostic context therefore propagates on its own through Node's
  `AsyncLocalStorage`; a caller who adds `observeOn`/`subscribeOn` downstream owns reinstating it.
