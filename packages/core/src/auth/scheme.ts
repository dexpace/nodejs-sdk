// SPDX-License-Identifier: MIT
// packages/core/src/auth/scheme.ts

/**
 * AUTH-1: the recognized auth scheme set. `NO_AUTH` is a distinct sentinel meaning "may run
 * anonymously / skip credential stamping", not a wire scheme.
 *
 * A string-literal union, not a TypeScript `enum` — `erasableSyntaxOnly` bars enums, and the scheme
 * set has no behavior beyond identity and ordering. Same call 4c made for `Stage`.
 *
 * @public
 */
export type AuthScheme = 'OAUTH2' | 'API_KEY' | 'BASIC' | 'DIGEST' | 'NO_AUTH';

// There is deliberately no `AUTH_SCHEMES` array beside the union. One shipped briefly, documented
// "for enumeration", and nothing ever enumerated it: `availableSchemesOf` derives AUTH-5's set from
// which credentials are configured, and every other reader branches on the union exhaustively. Its
// only test asserted the array's five members against the union's five members, which is the
// constant restated rather than a behaviour, and would have passed against any five-element array.
