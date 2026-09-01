interface AttemptState {
  failures: number[];
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export class LoginLimiter {
  private readonly attempts = new Map<string, AttemptState>();

  isBlocked(key: string, now = Date.now()): boolean {
    const state = this.attempts.get(key);
    if (!state) return false;
    state.failures = state.failures.filter((time) => now - time < WINDOW_MS);
    if (state.failures.length === 0) this.attempts.delete(key);
    return state.failures.length >= MAX_FAILURES;
  }

  recordFailure(key: string, now = Date.now()): void {
    const state = this.attempts.get(key) ?? { failures: [] };
    state.failures = state.failures.filter((time) => now - time < WINDOW_MS);
    state.failures.push(now);
    this.attempts.set(key, state);
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}

