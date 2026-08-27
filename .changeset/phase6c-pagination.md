---
'@dexpace/core': minor
---

Add pagination support: `Paginator` (items and pages views), `Page` with `AsyncDisposable` support, built-in strategies (`cursorStrategy`, `pageNumberStrategy`, `linkHeaderStrategy`), and `paginateWithFetchers`. Note: TypeScript consumers utilizing Explicit Resource Management (`await using`) against `Page` should ensure `"ESNext.Disposable"` (or `esnext`) is included in their compiler `lib`.

