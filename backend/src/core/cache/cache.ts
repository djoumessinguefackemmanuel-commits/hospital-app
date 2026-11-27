import type Redis from 'ioredis';

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Supprime toutes les clés commençant par `prefix` (invalidation d'un paramètre, etc.). */
  delByPrefix(prefix: string): Promise<void>;
  /** Incrément atomique ; la durée de vie est posée à la création de la clé. */
  incr(key: string, ttlSec: number): Promise<number>;
}

export class MemoryCache implements Cache {
  private readonly store = new Map<string, { value: unknown; expiresAt?: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.live(key)?.value as T | undefined;
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlSec ? this.now() + ttlSec * 1000 : undefined });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of [...this.store.keys()]) if (key.startsWith(prefix)) this.store.delete(key);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const current = this.live(key);
    if (!current) {
      this.store.set(key, { value: 1, expiresAt: this.now() + ttlSec * 1000 });
      return 1;
    }
    current.value = (current.value as number) + 1;
    return current.value as number;
  }
}

export class RedisCache implements Cache {
  constructor(
    private readonly redis: Redis,
    private readonly namespace = 'hms',
  ) {}

  private k(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.k(key));
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSec) await this.redis.set(this.k(key), raw, 'EX', ttlSec);
    else await this.redis.set(this.k(key), raw);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }

  async delByPrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${this.k(prefix)}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const value = await this.redis.incr(this.k(key));
    if (value === 1) await this.redis.expire(this.k(key), ttlSec);
    return value;
  }
}
