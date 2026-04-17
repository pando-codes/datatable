/**
 * Id generator strategy. Pulled out so tests can supply a deterministic
 * counter-based generator instead of relying on `crypto.randomUUID` (which
 * the project test setup mocks to a fixed value).
 */

export type IdGenerator = () => string;

/**
 * Counter-backed generator. Deterministic and collision-free within a
 * single generator instance. Default choice for tests.
 */
export function createCounterIdGenerator(prefix = "id"): IdGenerator {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

/**
 * UUID-backed generator. Uses `crypto.randomUUID` when available. Suitable
 * for production use of the memory adapter (demos, playgrounds).
 */
export function uuidIdGenerator(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: Math.random-based. Not cryptographically strong; adequate
  // for the memory adapter which is never a production store.
  return `uuid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
