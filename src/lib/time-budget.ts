/**
 * Time budget helpers (Issue #23).
 *
 * Pure by design: no storage, no React, no ledger mutation. Everything the
 * workbench shows about "how long will this route take, and do I have that much
 * time" is computed here so it can be tested without a browser.
 *
 * Three rules shape the numbers:
 *
 *  1. The budget is what the USER typed. Nothing is inferred from free text and
 *     no default (7 days, 60 minutes) is assumed. When the two answers are not
 *     both present and valid, there is no budget — never a budget of zero.
 *  2. The route total counts each planned step once. A planned step that has
 *     been expanded into a Boss keeps its own planned estimate (see
 *     `withBossInProject`), so a contract's `estimatedMinutes` must never be
 *     added on top.
 *  3. The comparison is the WHOLE route, including already finished steps. It
 *     is not "remaining work".
 */

/** What the user says they can spend. Both answers are required. */
export interface ProjectTimeBudget {
  /** Integer days the user plans to spend. */
  plannedDays: number;
  /** Integer minutes available per day. */
  dailyMinutes: number;
}

/** A year of planning is already beyond what this estimate can mean. */
export const MAX_PLANNED_DAYS = 365;
/** One day has 1440 minutes; anything above is not a daily budget. */
export const MAX_DAILY_MINUTES = 1440;

function isCountInRange(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * Validates an untrusted budget. Returns undefined for anything unusable so the
 * caller can DROP the field instead of failing the whole ledger — `loadLedger`
 * treats a present-but-malformed key as corruption and would otherwise discard
 * every research record in the browser.
 */
export function sanitizeTimeBudget(value: unknown): ProjectTimeBudget | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as { plannedDays?: unknown; dailyMinutes?: unknown };
  if (!isCountInRange(raw.plannedDays, MAX_PLANNED_DAYS)) return undefined;
  if (!isCountInRange(raw.dailyMinutes, MAX_DAILY_MINUTES)) return undefined;
  return { plannedDays: raw.plannedDays, dailyMinutes: raw.dailyMinutes };
}

/** True only when both answers are present and valid. */
export function isTimeBudgetComplete(budget: ProjectTimeBudget | undefined): budget is ProjectTimeBudget {
  return sanitizeTimeBudget(budget) !== undefined;
}

/** Total minutes the user can spend, or undefined when the budget is incomplete. */
export function totalBudgetMinutes(budget: ProjectTimeBudget | undefined): number | undefined {
  const clean = sanitizeTimeBudget(budget);
  return clean === undefined ? undefined : clean.plannedDays * clean.dailyMinutes;
}

/**
 * Minutes by which the route overshoots the budget. Returns 0 when the route
 * fits exactly (equal is not a warning) and 0 when there is no budget, so the
 * caller never renders a number derived from a missing answer.
 */
export function overBudgetMinutes(
  routeMinutes: number,
  budget: ProjectTimeBudget | undefined,
): number {
  const total = totalBudgetMinutes(budget);
  if (total === undefined) return 0;
  return Math.max(0, routeMinutes - total);
}

/** How many daily sessions a single step needs. */
export function workSessions(stepMinutes: number, dailyMinutes: number): number {
  if (!Number.isFinite(stepMinutes) || !Number.isFinite(dailyMinutes) || dailyMinutes <= 0) return 0;
  return Math.max(1, Math.ceil(stepMinutes / dailyMinutes));
}

export interface RouteMinutes {
  /** Sum of every planned step's estimate, finished steps included. */
  total: number;
  /**
   * False when any milestone has no real planned steps. Legacy projects store
   * no `steps`, and `deriveRoadmap` substitutes a 1-minute placeholder for
   * those — counting that would invent a total, so it is reported instead.
   */
  estimable: boolean;
}

/**
 * Sums the route. Each step is counted exactly once; a step whose estimate is
 * missing or not a finite number makes the whole route non-estimable rather
 * than silently contributing zero.
 */
export function sumRouteMinutes(
  milestones: readonly { steps?: readonly { estimatedMinutes?: unknown }[] }[] | undefined,
): RouteMinutes {
  if (!Array.isArray(milestones) || milestones.length === 0) return { total: 0, estimable: false };
  let total = 0;
  let estimable = true;
  for (const milestone of milestones) {
    if (!Array.isArray(milestone?.steps)) {
      estimable = false;
      continue;
    }
    for (const step of milestone.steps) {
      const minutes = step?.estimatedMinutes;
      if (typeof minutes === "number" && Number.isFinite(minutes)) {
        total += minutes;
      } else {
        estimable = false;
      }
    }
  }
  return { total, estimable };
}
