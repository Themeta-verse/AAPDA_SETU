/**
 * Official warning semantics.
 *
 * ===================================================================
 * THE DISTINCTION THIS FILE EXISTS TO PROTECT
 * ===================================================================
 *
 * "There is no warning" and "we could not read the warning source" are different
 * facts. Only the first is reassuring, and only the first may be acted on. This
 * module encodes that distinction as a three-state value so it cannot be lost in
 * a component, a boolean coercion, or a default parameter.
 *
 *   true   a published warning was confirmed active
 *   false  every tracked product was readable and clear
 *   null   UNKNOWN — at least one product could not be read
 *
 * The failure mode this prevents is concrete and was present in the original
 * code: an unreadable source was collapsed into `false`, so an outage of
 * mausam.imd.gov.in rendered as a reassuring "no official warnings" banner at
 * the exact moment a user might need it.
 *
 * `null` is therefore never defaulted, never coerced to `false`, and never
 * treated as "fine" by callers.
 */

export type OfficialWarningState = true | false | null;

export type OfficialWarningAuthority = 'IMD' | 'INCOIS';

/**
 * Result of inspecting one upstream product.
 *
 * This is the canonical shape, defined once in `adapters/types.ts` and used by
 * the risk engine, the command center and this module alike. It is re-exported
 * here rather than redefined so that a second, divergent copy of the warning
 * contract cannot drift into existence.
 */
export type { OfficialWarningStatus as OfficialWarningProduct } from '@/integrations/adapters/types';

import type { OfficialWarningStatus } from '@/integrations/adapters/types';

/**
 * Collapse per-product results into one authoritative tri-state.
 *
 * Rules, in order of precedence:
 *   1. Any confirmed active warning  -> true
 *   2. Any unreadable product        -> null   (blocks the all-clear)
 *   3. Otherwise, all read and clear -> false
 *
 * Rule 2 is the important one: an unreachable source vetoes `false`.
 */
export function summarizeOfficialWarnings(
  products: readonly OfficialWarningStatus[],
): OfficialWarningState {
  if (products.length === 0) return null;

  // A confirmed warning outranks any readability problem.
  if (products.some((p) => p.active === true)) return true;

  // `status !== 'live'` is the retriever's own statement that the product could
  // not be inspected. That is what makes an all-clear unprovable.
  if (products.some((p) => p.status !== 'live')) return null;

  if (products.some((p) => p.active === null)) return null;

  return false;
}

/** True only for a confirmed active warning. `null` is NOT an all-clear. */
export function isConfirmedWarning(state: OfficialWarningState): boolean {
  return state === true;
}

/**
 * True only when every product was readable AND clear.
 *
 * Use this to decide whether an "all clear" is safe to display. Callers must not
 * treat `false` from `isConfirmedWarning` as its negation.
 */
export function isVerifiedAllClear(state: OfficialWarningState): boolean {
  return state === false;
}

/**
 * The authority responsible for a confirmed warning, or null.
 *
 * Only meaningful when `summarizeOfficialWarnings` returns `true`; for every
 * other state this returns null rather than naming an authority that did not
 * actually issue anything.
 */
export function confirmedWarningAuthority(
  products: readonly OfficialWarningStatus[],
): OfficialWarningAuthority | null {
  const issuing = products.find((p) => p.active === true);
  if (!issuing) return null;
  const authority = String(issuing.authority).toUpperCase();
  return authority === 'IMD' || authority === 'INCOIS' ? authority : null;
}

/** Human-facing phrasing that is accurate for each of the three states. */
export function describeOfficialWarningState(state: OfficialWarningState): string {
  switch (state) {
    case true:
      return 'Official warning in force';
    case false:
      return 'All official sources readable — no warning in force';
    case null:
      return 'Official warning status unknown';
  }
}

/**
 * Products that failed to be read, for display.
 *
 * Returns real blockers with their real evidence so a user can judge the
 * reliability of the gap instead of being told only that something is missing.
 */
export function unreadableProducts(
  products: readonly OfficialWarningStatus[],
): OfficialWarningStatus[] {
  return products.filter((p) => p.status !== 'live');
}
