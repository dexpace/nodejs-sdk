// SPDX-License-Identifier: MIT
// packages/core/src/auth/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * AUTH-6 (the selected tier lists no satisfiable scheme) and AUTH-35 (a `TokenProvider` returned
 * null or an already-expired token).
 *
 * AUTH-6, not AUTH-4: AUTH-4 governs only WHICH tier is selected — most-specific-present, with no
 * fall-through — and it is AUTH-6 that requires "a distinct auth-resolution error (carrying both the
 * required schemes in preference order and the available schemes)" when that tier turns out to be
 * unsatisfiable.
 *
 * The scheme lists are `readonly` FIELDS, not only interpolated prose. AUTH-6 requires the error to
 * carry both the required schemes in preference order and the available schemes, and
 * `docs/knowledge/harvested/error-handling.md` requires identifying inputs to be `readonly` fields "so they
 * survive serialization and appear in structured logs". Both are `undefined` on the AUTH-35
 * construction path, which has no scheme lists to carry.
 *
 * Typed `readonly string[]` rather than `readonly AuthScheme[]`: this module is the taxonomy leaf
 * every other auth module depends on, and `scheme.ts` has no reason to depend back on it. A union of
 * string literals is assignable to `string`, so callers pass `AuthScheme[]` values unchanged.
 *
 * @public
 */
export class AuthResolutionError extends DexpaceError {
  /** The selected tier's schemes, in declared preference order. Absent on the AUTH-35 path. */
  readonly requiredSchemes: readonly string[] | undefined;
  /** The schemes a credential was actually configured for. Absent on the AUTH-35 path. */
  readonly availableSchemes: readonly string[] | undefined;

  /**
   * Both lists are COPIED, not aliased. They are typed `readonly` and this class is public surface,
   * so a caller-owned array stored by reference would leave a `readonly` field whose contents change
   * after the error was constructed. `unsatisfiable()` below delegates here rather than copying a
   * second time, so there is exactly one copy site.
   *
   * @param message - the human-readable failure description.
   * @param requiredSchemes - the selected tier's schemes, in preference order.
   * @param availableSchemes - the schemes a credential was configured for.
   */
  constructor(
    message: string,
    requiredSchemes?: readonly string[],
    availableSchemes?: readonly string[],
  ) {
    super(message);
    this.requiredSchemes =
      requiredSchemes === undefined
        ? undefined
        : Object.freeze([...requiredSchemes]);
    this.availableSchemes =
      availableSchemes === undefined
        ? undefined
        : Object.freeze([...availableSchemes]);
  }

  /**
   * AUTH-6's unsatisfiable-descriptor case: the caller configured a tier, but none of its listed
   * schemes has a matching credential.
   *
   * @param requiredSchemes - the selected tier's schemes, in preference order.
   * @param availableSchemes - the schemes a credential was configured for.
   * @returns the error, with both lists copied onto its own fields by the constructor.
   */
  static unsatisfiable(
    requiredSchemes: readonly string[],
    availableSchemes: readonly string[],
  ): AuthResolutionError {
    return new AuthResolutionError(
      `no requirement is satisfiable; required one of [${requiredSchemes.join(', ')}], available: [${availableSchemes.join(', ')}]`,
      requiredSchemes,
      availableSchemes,
    );
  }
}

/**
 * AUTH-28: a credential would have been attached to a non-HTTPS URL.
 *
 * The offending URL is deliberately NOT carried — a URL can hold userinfo and query-string secrets,
 * and `docs/knowledge/harvested/error-handling.md` bars interpolating secrets into a message that travels into
 * logs. The step name and scheme identify the fault without that risk.
 *
 * @public
 */
export class PlaintextCredentialError extends DexpaceError {
  /** The concrete step that refused, as AUTH-28 requires the error to name. */
  readonly stepName: string;
  /** The resolved auth scheme whose credential would have been stamped. */
  readonly scheme: string;

  /**
   * @param stepName - the concrete step that refused.
   * @param scheme - the resolved auth scheme.
   */
  constructor(stepName: string, scheme: string) {
    super(
      `${stepName} refuses to send a ${scheme} credential over a non-HTTPS URL`,
    );
    this.stepName = stepName;
    this.scheme = scheme;
  }
}
