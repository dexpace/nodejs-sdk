// SPDX-License-Identifier: MIT
// packages/core/src/config/build-info.test.ts
// Exercises: CFG-36 (version and runtime identity resolved once at load, each falling back to a
// non-blank "unknown", plus a default ordered [sdkToken, runtimeToken] list with no blank entry),
// NFR-15 (the version is the real compiled-in one, never the placeholder, on any build whose
// codegen step ran).
import {describe, expect, test} from 'bun:test';
import {SDK_VERSION} from '../generated/version.js';
import type {RuntimeHost} from './build-info.js';
import {detectRuntimeIdentity, getBuildInfo} from './build-info.js';

describe('getBuildInfo (CFG-36, NFR-15)', () => {
  test('reports the generated build-time version, not the placeholder', () => {
    // The first assertion pins only that nothing transforms the generated constant on its way into
    // the descriptor: it borrows the implementation's own import, so it cannot carry NFR-15 alone.
    // The second one does, as does the token-ordering test below, which spells the prefix out.
    expect(getBuildInfo().sdkVersion).toBe(SDK_VERSION);
    expect(getBuildInfo().sdkVersion).not.toBe('unknown');
  });

  test('reports a non-blank runtime identity', () => {
    expect(getBuildInfo().runtimeIdentity.trim()).not.toBe('');
  });

  test('identifies this runtime as Node-compatible, since process.version is defined here', () => {
    expect(getBuildInfo().runtimeIdentity).toMatch(/^node\//u);
  });

  test('orders identityTokens as [sdkToken, runtimeToken]', () => {
    const {identityTokens, sdkVersion, runtimeIdentity} = getBuildInfo();

    expect(identityTokens).toEqual([
      `dexpace-sdk/${sdkVersion}`,
      runtimeIdentity,
    ]);
  });

  test('emits no blank identity token', () => {
    for (const token of getBuildInfo().identityTokens) {
      expect(token.trim()).not.toBe('');
    }
  });

  test('resolves once, returning the same frozen instance on every call', () => {
    expect(getBuildInfo()).toBe(getBuildInfo());
    expect(Object.isFrozen(getBuildInfo())).toBe(true);
    expect(Object.isFrozen(getBuildInfo().identityTokens)).toBe(true);
  });
});

describe('detectRuntimeIdentity (CFG-36)', () => {
  test('reports a Node-style token when process.version is present', () => {
    const host: RuntimeHost = {process: {version: 'v20.11.0'}};

    expect(detectRuntimeIdentity(host)).toBe('node/20.11.0');
  });

  test('prefers process over Deno and navigator', () => {
    const host: RuntimeHost = {
      process: {version: 'v20.11.0'},
      Deno: {version: {deno: '1.44.0'}},
      navigator: {userAgent: 'Mozilla/5.0'},
    };

    expect(detectRuntimeIdentity(host)).toBe('node/20.11.0');
  });

  test('reports a Deno-style token when only Deno is present', () => {
    const host: RuntimeHost = {Deno: {version: {deno: '1.44.0'}}};

    expect(detectRuntimeIdentity(host)).toBe('deno/1.44.0');
  });

  test('reports the user agent when only navigator is present', () => {
    const host: RuntimeHost = {navigator: {userAgent: 'Mozilla/5.0'}};

    expect(detectRuntimeIdentity(host)).toBe('Mozilla/5.0');
  });

  test('falls back to the non-blank literal "unknown" when nothing is detectable', () => {
    expect(detectRuntimeIdentity({})).toBe('unknown');
  });

  test('treats a blank detected value as undetectable rather than emitting a blank token', () => {
    const host: RuntimeHost = {
      process: {version: '   '},
      navigator: {userAgent: ''},
    };

    expect(detectRuntimeIdentity(host)).toBe('unknown');
  });

  test('ignores a non-string detected value', () => {
    const host: RuntimeHost = {process: {version: 20}};

    expect(detectRuntimeIdentity(host)).toBe('unknown');
  });
});

describe('detectRuntimeIdentity sanitization (CFG-36, RECOV-33)', () => {
  test('trims a detected value rather than carrying its surrounding whitespace into the token', () => {
    const host: RuntimeHost = {process: {version: '  v20.11.0  '}};

    expect(detectRuntimeIdentity(host)).toBe('node/20.11.0');
  });

  test('treats a version that strips to nothing as undetectable', () => {
    // `'v'` alone leaves `node/` with no version behind it, which is a worse answer than saying so.
    const host: RuntimeHost = {process: {version: 'v'}};

    expect(detectRuntimeIdentity(host)).toBe('unknown');
  });

  test('rejects a detected value that is not header-safe', () => {
    // The value is ambient and unvalidated at its source, and RECOV-33 puts it straight into a
    // header. One non-ASCII byte in `navigator.userAgent` used to make the default client-identity
    // step reject every outbound request with a HeaderValidationError.
    for (const host of [
      {navigator: {userAgent: 'Mozilla/5.0 (caf\u00e9)'}},
      {process: {version: 'v1.0\r\nX-Injected: yes'}},
      {Deno: {version: {deno: '1.0\nX: y'}}},
      {navigator: {userAgent: 'Mozilla/5.0 \u007f'}},
    ] satisfies RuntimeHost[]) {
      expect(detectRuntimeIdentity(host)).toBe('unknown');
    }
  });

  test('emits only header-safe characters for every host shape it accepts', () => {
    const headerSafe = /^[\t\u0020-\u007e]+$/u;

    for (const host of [
      {},
      {process: {version: 'v20.11.0'}},
      {Deno: {version: {deno: '1.44.0'}}},
      {navigator: {userAgent: 'Mozilla/5.0'}},
      {navigator: {userAgent: 'Mozilla/5.0 (caf\u00e9)'}},
    ] satisfies RuntimeHost[]) {
      expect(detectRuntimeIdentity(host)).toMatch(headerSafe);
    }
  });
});
