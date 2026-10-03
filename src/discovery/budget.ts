/**
 * Bounded request budget shared by robots, redirects and every HTTP request
 * in a discovery run. Ports BeyondSEO `discovery.RequestBudget`.
 *
 * The budget is the safety rail that keeps a discovery run bounded even when
 * a provider is slow: requests *and* wall-clock both count, and exhausting
 * either advances to the next provider instead of retrying.
 */

export class RequestBudget {
  readonly limit: number;
  readonly seconds: number;
  used = 0;
  readonly deadline: number;

  constructor(limit = 16, seconds = 90) {
    this.limit = limit;
    this.seconds = seconds;
    this.deadline = Date.now() + seconds * 1000;
  }

  /** Throw when the request count or the wall-clock budget is spent. */
  take(): void {
    if (this.used >= this.limit || Date.now() >= this.deadline) {
      throw new Error("discovery_request_budget_exhausted");
    }
    this.used++;
  }

  /** Milliseconds remaining in the wall-clock budget (never negative). */
  remainingMs(): number {
    return Math.max(0, this.deadline - Date.now());
  }
}
