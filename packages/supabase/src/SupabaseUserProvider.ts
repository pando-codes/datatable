/**
 * Supabase UserProvider adapter.
 *
 * Queries the `profiles` table for lookup and resolution, and delegates
 * "who is the current user" to a getter the app owns — typically backed
 * by AuthContext. This keeps the adapter out of auth-flow management:
 * it only knows how to answer identity questions about users that
 * already exist.
 *
 * Search is server-side using PostgREST's ilike operator on the
 * profile display fields (full_name, username, email). Adapters that
 * need fuzzier matching (typo tolerance, ranking) should replace this
 * with a dedicated search backend.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Page,
  PageOpts,
  User,
  UserProvider,
} from "@pando/datatable-contracts";


export interface SupabaseUserProviderOptions {
  client: SupabaseClient<any>;
  /**
   * Synchronous accessor for the current user. Typically wired to a
   * React AuthContext value in the host app. Returns null when
   * unauthenticated or when auth state has not resolved yet.
   */
  getCurrentUser: () => User | null;
  /**
   * Optional subscription to current-user changes. When provided, the
   * adapter forwards events via UserProvider.subscribe.
   */
  subscribeCurrentUser?: (
    listener: (user: User | null) => void,
  ) => () => void;
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
};

export class SupabaseUserProvider implements UserProvider {
  private readonly client: SupabaseClient<any>;
  private readonly getCurrentUserFn: () => User | null;
  private readonly subscribeCurrentUserFn?: (
    listener: (user: User | null) => void,
  ) => () => void;

  constructor(opts: SupabaseUserProviderOptions) {
    this.client = opts.client;
    this.getCurrentUserFn = opts.getCurrentUser;
    this.subscribeCurrentUserFn = opts.subscribeCurrentUser;
  }

  current(): User | null {
    return this.getCurrentUserFn();
  }

  subscribe(listener: (user: User | null) => void): () => void {
    listener(this.current());
    if (!this.subscribeCurrentUserFn) return () => {};
    return this.subscribeCurrentUserFn(listener);
  }

  async lookup(query: string, opts?: PageOpts): Promise<Page<User>> {
    const limit = opts?.limit ?? 50;
    const start = cursorToIndex(opts?.cursor) ?? 0;
    const needle = query.trim();

    let q = this.client
      .from("profiles")
      .select("id, full_name, avatar_url, username");

    if (needle) {
      const escaped = escapeIlikePattern(needle);
      q = q.or(
        `full_name.ilike.%${escaped}%,username.ilike.%${escaped}%`,
      );
    }

    const { data, error } = await q
      .order("full_name", { ascending: true })
      .range(start, start + limit);

    if (error) throw toError(error, "Failed to lookup users");

    const rows = (data as ProfileRow[] | null) ?? [];
    const items = rows.slice(0, limit).map(toUser);
    const hasMore = rows.length > limit;

    return {
      items,
      nextCursor: hasMore ? String(start + limit) : null,
    };
  }

  async resolve(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client
      .from("profiles")
      .select("id, full_name, avatar_url, username")
      .in("id", ids);
    if (error) throw toError(error, "Failed to resolve users");
    return ((data as ProfileRow[] | null) ?? []).map(toUser);
  }
}

function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    displayName: row.full_name ?? row.username ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
  };
}

function escapeIlikePattern(pattern: string): string {
  // ilike uses % and _ as wildcards; escape any literal occurrences in
  // the user's query so they match literally rather than as patterns.
  return pattern.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function cursorToIndex(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : null;
}

function toError(err: { message?: string } | Error, fallback: string): Error {
  if (err instanceof Error) return err;
  return new Error(err.message || fallback);
}
