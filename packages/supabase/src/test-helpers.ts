/**
 * Shared test scaffolding for Supabase adapter tests.
 *
 * Provides a fluent query-builder mock that mimics the PostgREST client
 * surface (select/insert/update/delete/eq/in/order/range/or/single, plus
 * thenable for direct await). Adapters accept the client via constructor
 * so tests pass in these mocks directly rather than relying on the
 * global Supabase mock in test/setup.ts.
 */

import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";


export type MockResult = {
  data?: unknown;
  error?: { message: string } | null;
};

export interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (resolve: (r: MockResult) => void) => void;
}

export function mockBuilder(result: MockResult): MockBuilder {
  const builder = {} as MockBuilder;
  const self = () => builder;
  const resolved = () => Promise.resolve(result) as never;
  // All filter/modifier methods return the builder so chains of any
  // length resolve at the final await. The builder itself is thenable,
  // so either `await builder.order(...)` or `await builder.range(...)`
  // works without a dedicated terminal call.
  builder.select = vi.fn(self);
  builder.insert = vi.fn(self);
  builder.update = vi.fn(self);
  builder.delete = vi.fn(self);
  builder.upsert = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.neq = vi.fn(self);
  builder.in = vi.fn(self);
  builder.is = vi.fn(self);
  builder.or = vi.fn(self);
  builder.order = vi.fn(self);
  builder.range = vi.fn(self);
  builder.limit = vi.fn(self);
  // single/maybeSingle are true terminators that return Promises.
  builder.single = vi.fn(resolved);
  builder.maybeSingle = vi.fn(resolved);
  builder.then = (resolve: (r: MockResult) => void) => resolve(result);
  return builder;
}

export interface MockClient {
  from: ReturnType<typeof vi.fn>;
  storage: { from: ReturnType<typeof vi.fn> };
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
  };
  functions: { invoke: ReturnType<typeof vi.fn> };
  _builders: MockBuilder[];
  _storageBuckets: MockStorageBucket[];
}

export interface MockStorageBucket {
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getPublicUrl: ReturnType<typeof vi.fn>;
  createSignedUrl: ReturnType<typeof vi.fn>;
}

export function mockStorageBucket(
  overrides: Partial<MockStorageBucket> = {},
): MockStorageBucket {
  return {
    upload: vi.fn(() => Promise.resolve({ data: { path: "p" }, error: null })),
    remove: vi.fn(() => Promise.resolve({ data: [], error: null })),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://example/file" } })),
    createSignedUrl: vi.fn(() =>
      Promise.resolve({ data: { signedUrl: "https://example/signed" }, error: null }),
    ),
    ...overrides,
  };
}

export interface MockClientOptions {
  /** Results returned by successive client.from() chains. */
  tables?: MockResult[];
  /** Storage bucket mocks, by bucket name. */
  storage?: Record<string, MockStorageBucket>;
  /** functions.invoke() result. */
  invoke?: { data?: unknown; error?: { message: string } | null };
}

export function mockClient(opts: MockClientOptions = {}): MockClient {
  const builders = (opts.tables ?? []).map(mockBuilder);
  const storageBuckets: MockStorageBucket[] = [];
  let tableIdx = 0;
  return {
    _builders: builders,
    _storageBuckets: storageBuckets,
    from: vi.fn(() => {
      const b = builders[Math.min(tableIdx, builders.length - 1)];
      tableIdx += 1;
      if (!b) {
        throw new Error(
          `mockClient: no builder configured for call #${tableIdx} to client.from()`,
        );
      }
      return b;
    }),
    storage: {
      from: vi.fn((bucket: string) => {
        const b = opts.storage?.[bucket] ?? mockStorageBucket();
        storageBuckets.push(b);
        return b;
      }),
    },
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    functions: {
      invoke: vi.fn(() =>
        Promise.resolve(opts.invoke ?? { data: null, error: null }),
      ),
    },
  };
}

export function asSupabaseClient(client: MockClient): SupabaseClient<any> {
  return client as unknown as SupabaseClient<any>;
}
