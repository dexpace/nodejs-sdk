# First release

Nothing in this repository has been published. All nine publishable packages sit at `version: "0.0.0"`,
[`.github/workflows/release.yml`](../.github/workflows/release.yml) is authored and **inert**, and `NFR-16`
— publish provenance — is the one requirement that cannot be closed without a real registry. This note is
the release-readiness record: what is already wired, what the release mechanics are confirmed to be, and the
blockers that must clear before a first publish can succeed. It is edited as those blockers clear.

**Where it came from.** This was the `NFR-16` row of `docs/deferred-items.md` until 2026-09-04, the day that
register was dissolved. Four of its ten rows were decided that day (`open-items.md` Section W); the five that
survived beside this one are unscheduled deferrals with a trigger and nothing to act on, and they were
archived into
[`work/mvp/2026-09-04-register-retirement-purge.md`](./work/mvp/2026-09-04-register-retirement-purge.md).
This material earned a file of its own instead, at the `docs/` root beside [`open-items.md`](./open-items.md)
and [`deviations.md`](./deviations.md), because it is a live document rather than a dated record — the
blockers below are things someone will do, and this is where they get struck out.

**Where the requirement is ledgered.** `NFR-16` is a **SHOULD**: published artifacts are cryptographically
signed for provenance, with signing enforced on the release/CI path and gracefully optional in local builds.
Item 14 of
[`sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`](./sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md)
is where its intended verification is recorded — run `prepublishOnly` and a real `npm publish --provenance`
— and where it was split from `NFR-12`, which the two-clean-builds gate closed on evidence on 2026-08-29.
`open-items.md` Section D carries the same row under its `d-nfr-16-provenance` anchor, and the workflow's own
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
