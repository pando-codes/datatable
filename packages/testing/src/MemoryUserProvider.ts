/**
 * In-memory UserProvider adapter. Seeded with a fixed user roster.
 */

import type { Page, PageOpts, User, UserProvider } from "@pando/datatable-contracts";
import { Emitter } from "./internals/emitter";

export interface MemoryUserProviderSeed {
  users: User[];
  currentUserId?: string | null;
}

export class MemoryUserProvider implements UserProvider {
  private users: Map<string, User> = new Map();
  private currentUser: User | null = null;
  private readonly emitter = new Emitter<User | null>();

  constructor(seed: MemoryUserProviderSeed) {
    for (const user of seed.users) {
      this.users.set(user.id, user);
    }
    if (seed.currentUserId) {
      this.currentUser = this.users.get(seed.currentUserId) ?? null;
    }
  }

  current(): User | null {
    return this.currentUser;
  }

  subscribe(listener: (user: User | null) => void): () => void {
    listener(this.currentUser);
    return this.emitter.subscribe(listener);
  }

  async lookup(query: string, opts?: PageOpts): Promise<Page<User>> {
    const needle = query.trim().toLowerCase();
    const matches = [...this.users.values()].filter((u) => {
      if (!needle) return true;
      return (
        u.displayName?.toLowerCase().includes(needle) ||
        u.email?.toLowerCase().includes(needle) ||
        u.id.toLowerCase().includes(needle)
      );
    });
    const limit = opts?.limit ?? 50;
    const start = cursorToIndex(opts?.cursor) ?? 0;
    const page = matches.slice(start, start + limit);
    const end = start + page.length;
    return {
      items: page,
      nextCursor: end < matches.length ? String(end) : null,
      totalCount: matches.length,
    };
  }

  async resolve(ids: string[]): Promise<User[]> {
    const out: User[] = [];
    for (const id of ids) {
      const u = this.users.get(id);
      if (u) out.push(u);
    }
    return out;
  }

  // ---- Test helpers ----

  _setCurrent(userId: string | null): void {
    this.currentUser = userId ? this.users.get(userId) ?? null : null;
    this.emitter.emit(this.currentUser);
  }
}

function cursorToIndex(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : null;
}
