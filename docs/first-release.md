# First release

Nothing in this repository has been published. All nine publishable packages sit at `version: "0.0.0"`,
[`.github/workflows/release.yml`](../.github/workflows/release.yml) is authored and **inert**, and `NFR-16`
— publish provenance — is the one requirement that cannot be closed without a real registry. This note is
the release-readiness record: what is already wired, what the release mechanics are confirmed to be, the
blockers that must clear before a first publish can succeed, and the changes whose deadline is the first
version bump rather than the publish itself. It is edited as those blockers clear and those decisions are
taken.

**Where it came from.** This was the `NFR-16` row of `docs/deferred-items.md` until 2026-09-04, the day that
register was dissolved. Four of its ten rows were decided that day (the dissolved register's Section W); the five that
survived beside this one are unscheduled deferrals with a trigger and nothing to act on, and they were
archived into
[`work/mvp/2026-09-04-register-retirement-purge.md`](./work/mvp/2026-09-04-register-retirement-purge.md).
This material earned a file of its own instead, at the `docs/` root beside [the dissolved open-items register](./work/mvp/2026-09-04-open-items-dissolution.md)
and [`deviations.md`](./deviations.md), because it is a live document rather than a dated record — the
blockers below are things someone will do, and this is where they get struck out. It took on a second kind
of content the same day: two the dissolved register's rows whose only stated trigger was this release moved here, for
the same reason, and are the last section below.

**Where the requirement is ledgered.** `NFR-16` is a **SHOULD**: published artifacts are cryptographically
signed for provenance, with signing enforced on the release/CI path and gracefully optional in local builds.
Item 14 of
[`sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`](./sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md)
is where its intended verification is recorded — run `prepublishOnly` and a real `npm publish --provenance`
— and where it was split from `NFR-12`, which the two-clean-builds gate closed on evidence on 2026-08-29.
the dissolved register's Section D carries the same row under its `d-nfr-16-provenance` anchor, and the workflow's own
header comment points here.

## What is wired

**The release workflow, authored 2026-09-02.** `.github/workflows/release.yml` triggers on `push` to `main`
and on nothing else (`:32-34`), with a second `if: github.ref == 'refs/heads/main'` guard on the job
(`:56`) so a copied trigger cannot publish from a branch. It pins Bun from `.bun-version` exactly the way
`ci.yml` does (`:67-69`), installs with `--frozen-lockfile` (`:71-72`), runs `bun run build` so a broken
tree fails before the registry is touched (`:80-81`), and hands `changesets/action@v1` the lockfile-pinned
binary directly — `publish: node_modules/.bin/changeset publish` (`:98`), not `bun run changeset publish`
(which routes through `scripts/changeset.mjs`, a rename wrapper) and not `bun x` (which would fall back to
fetching the CLI from the registry). It sets `permissions: {contents: write, pull-requests: write, id-token:
write}` (`:43-49`) — `id-token: write` is what makes provenance possible at all, since npm exchanges the
GitHub OIDC token for the signed attestation — `NPM_CONFIG_PROVENANCE: 'true'` (`:108`) so every
`npm publish` the action drives is a provenance publish rather than a flag one call site can forget, and a
`concurrency` group keyed on the workflow and ref with `cancel-in-progress: false` (`:39-41`) so two pushes
to `main` cannot publish concurrently and a publish already writing to the registry is never killed
mid-flight.

*Corrected 2026-08-29, kept because §10 Item 14 once claimed otherwise:* before that date only
`prepublishOnly` was wired. `--provenance` appeared in no `package.json`, no workflow and no `.npmrc`, and
there was no release workflow at all. There is still no `.npmrc`; `changesets/action` writes one from
`NPM_TOKEN` at run time.

**`prepublishOnly`, on all nine publishable packages.** Each runs
`bun run build && bun run api:ci && publint . && attw --pack . --ignore-rules cjs-resolves-to-esm` (for
example `packages/core/package.json:34`), so npm aborts that package's publish if the build, the API-report
check, the release-shape lint or the types-resolution check fails. The runner satisfies it out of the frozen
install: Bun, `@microsoft/api-extractor`, `publint` and `@arethetypeswrong/cli` are all root
devDependencies. The two `private` packages — `@dexpace/shrink-test` and `@dexpace/transport-conformance` —
carry no `prepublishOnly`, because nothing publishes them.

**Release mechanics, confirmed by the maintainer 2026-09-02.** Releases run from `main` only, so no branch,
tag or manual dispatch can publish. Every package is still at `version: "0.0.0"`, so the **first
`changeset version` run sets the initial published version for all nine at once** — there is no per-package
history to reconcile and no partially released set to inherit. A change lands on `main` with a changeset,
the workflow opens or updates a "Version Packages" pull request, and merging that pull request runs the
workflow again with no changesets left, which is the run that publishes.

## Prerequisite already met — the `repository` field

The row this note replaces recorded two unmet manifest prerequisites. **One landed in `d64a107` and is
confirmed met as of 2026-09-04.** All nine publishable `package.json` files carry

```json
{"type": "git", "url": "git+https://github.com/dexpace/nodejs-sdk.git", "directory": "packages/<name>"}
```

naming the repository `git remote -v` reports as `origin`, so npm's rule that `--provenance` needs a
`repository` resolving to the source repository is satisfied. The two `private` packages carry none, which
is correct: nothing publishes them, so nothing checks them.

## Blockers

Three, in the order they will bite. None is fixed by anything in this repository's gates, which is why they
are written down rather than tested for.

1. **The `NPM_TOKEN` repository secret does not exist.** `changesets/action` writes `~/.npmrc` from
   `NPM_TOKEN` when it is set and skips publishing entirely when it is not, so the workflow publishes
   nothing today: it will still open and maintain the "Version Packages" pull request, and the publish step
   is a silent no-op. **This one is the maintainer's to do** — a repository secret is not a file anyone can
   land here.

2. **`.changeset/config.json` sets `"access": "restricted"`.** Verified still `restricted` on 2026-09-04.
   Provenance attestations go to a public transparency log and require a public package, so this conflicts
   directly with `NPM_CONFIG_PROVENANCE: 'true'` in the release workflow and the first publish fails at the
   registry. It is a decision, not an oversight: set the access to `public` to publish with provenance, or
   keep the scope private, drop the provenance setting, and record `NFR-16` as a deviation. The root
   [`README.md`](../README.md)'s "Releases" section states the same choice, and adds the third condition the
   registry imposes independently — npm issues provenance attestations for public **source** only.

3. **Exercising the provenance path needs a real registry.** `NFR-16`'s conformance test is behavioral — a
   CI/release build fails an unsigned publication, while a local build without keys still publishes unsigned
   — so it needs a real registry and a real OIDC token. Nothing short of a first real publish verifies it,
   which is why a SHOULD-level requirement is open with the workflow already written.

## Decisions owed before the first version bump

The blockers above are what stops a publish from *succeeding*. These two are a different thing and must not
be confused with them: neither breaks a publish, and a release that ignores both works. They are changes
that are free today and expensive after the version bump, so the first `changeset version` run is their
deadline rather than their obstacle.

**Why they live here.** Both were `UNSCHEDULED` items in [the dissolved open-items register](./work/mvp/2026-09-04-open-items-dissolution.md) — `H10` and
`H15`, Section H, Phase 6a — and both stated the same single trigger: *the pre-publish breaking-change batch,
before the first non-`0.0.0` release*. That batch is a release decision, so it belongs in the
release-readiness record rather than in a register of discoveries made after the work. Their IDs stay
reserved: the `### H10` and `### H15` headings remain in the dissolved register's as `MOVED` stubs pointing here, so
every citation of them still resolves — `packages/core/src/seams/serde.ts:99,170` cite `H15` from TSDoc
`@remarks`, and the Phase 6a checklist cites both.

**Why the batch has a deadline at all.** Every publishable package is at `version: "0.0.0"`, and semver's
initial-development carve-out — which Phase 3b's validation review already invoked once, for a narrowing of
its own — stops applying at 1.0. "Release mechanics" above is the mechanism: the first `changeset version`
run sets the initial published version for all nine packages at once, so that run is the last moment either
change below is free. After it, each is a major-version break taken against consumers who are already there.

### `H10` — one concept, two spellings across the seam and the handler layer

`Deserializer.deserialize(data, schema, typeName?)` takes the schema and its diagnostic label positionally;
`decodeResponse`/`decodeSuccessResponse` bundle the identical pair as `DecodeTarget<T>`. Both ship public, in
the same api-extractor report.

Each layer's choice is locally right. The positional form is three parameters, inside `max-params`, and
`Deserializer` is an SPI a third-party codec *implements*, where a positional shape is the smaller burden on
the implementer. The object form exists because positionally the handlers would be four parameters, which is
a lint error. The pair is nonetheless globally inconsistent: a codec author implements one spelling while a
caller uses the other. `docs/knowledge/harvested/api-design.md:14` ("optional parameters collected into a
single options object rather than a positional list past two parameters") points at the object form for both.

**The direction is already decided; only the timing is open.** Recorded on 2026-09-02 so a later reader does
not re-derive it:

> **Unify on the `DecodeTarget<T>` object form.** `docs/knowledge/harvested/api-design.md:14` points there,
> the handler layer already uses it, and a codec author implementing one spelling while a caller uses the
> other is the cost being paid every day it stays split.

It was not taken in the Phase 6a review pass because it is a breaking change to a published SPI, and a
review pass is not the place to take one alone.

### `H15` — no `AbortSignal` on two stream-driving SPI methods

The project-wide position was decided 2026-09-02 and is stated once:

> **A signal is required where the API drives a stream it did not open. Buffered-bytes APIs take none.**

Under that rule `toHttpError` and `Response.bytes()` take buffered bytes and correctly take no signal, and
SSE and pagination are long-lived I/O consumers and correctly do. Two sites fall on the other side of the
line and therefore owe one:

- `Deserializer.deserializeFrom(source: ReadableStream<Uint8Array>, …)` — `packages/core/src/seams/serde.ts:162`
- `Serializer.serializeTo(value, sink: WritableStream<Uint8Array>)` — `:96`

Both already carry a TSDoc `@remarks` citing the item, so the obligation is visible where the method is read
rather than only in a register. The corpus rules that apply are
`docs/knowledge/harvested/concurrency-and-async.md:18` ("every long-running async API must accept an options
object with `{ signal }`"), `:20` (accepting must be paired with honoring), and `:44` (a signal must reach
the actual I/O primitive).

**The mitigation is verified rather than assumed, and it bounds the cost of declining.** Abort **is** honored
transitively today: a transport that errors the body stream on abort makes `reader.read()` reject, the read
loop exits promptly, and `deserializeFrom` surfaces the `DOMException` cleanly. What is *not* interruptible
is the CPU-bound `JSON.parse` / `schema.parse` span after the drain completes, which no signal could cancel
without a streaming parser — and `JSON.parse` has no incremental form to build one on. So what is missing is
the parameter, not the behaviour; and adding a parameter to a published SPI is exactly the break that has a
deadline.

### The decision

Run the batch before the first `changeset version`, or decline it and carry both as permanent post-1.0
major-version debt. There is no third option that keeps either change free.

The two are **one break, not two.** They touch the same file — `packages/core/src/seams/serde.ts` — and
`H15`'s own text says so: *"H10's batch: same file, same break."* Taking either one means the other costs
nothing extra.

Whatever is taken needs a changeset (`bun run changeset`, not `bunx changeset`) and a regenerated
[`packages/core/etc/core.api.md`](../packages/core/etc/core.api.md) — both changes are to `@dexpace/core`'s
public seam, which the committed API report records and `bun run api` blocks on.
