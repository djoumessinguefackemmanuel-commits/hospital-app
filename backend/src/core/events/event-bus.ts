import { randomUUID } from 'node:crypto';
import type { DomainEvent, EventInput, EventPublisher, Tx } from '../../shared/contracts';
import type { Logger } from '../logger/logger';

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

export interface StoredEvent extends DomainEvent {
  attempts: number;
}

/** Stockage de l'outbox : l'écriture se fait dans la transaction métier (pattern outbox). */
export interface OutboxStore {
  add(event: DomainEvent, tx?: Tx): Promise<void>;
  /** Réserve (bail) les événements à publier, sans les verrouiller durablement. */
  claimPending(limit: number, now: Date): Promise<StoredEvent[]>;
  markPublished(eventId: string, at: Date): Promise<void>;
  markFailed(eventId: string, error: string, nextAttemptAt: Date, giveUp: boolean): Promise<void>;
}

/**
 * EventBus : publie dans l'outbox, puis le relais distribue aux abonnés.
 * Aucun module n'importe un autre module : ils s'abonnent à des types d'événements.
 */
export class EventBus implements EventPublisher {
  private readonly handlers = new Map<string, EventHandler[]>();

  constructor(private readonly store: OutboxStore) {}

  subscribe(type: string, handler: EventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async publish<T>(input: EventInput<T>, tx?: Tx): Promise<DomainEvent<T>> {
    const event: DomainEvent<T> = {
      eventId: randomUUID(),
      type: input.type,
      occurredAt: new Date().toISOString(),
      actorId: input.actorId,
      etablissementId: input.etablissementId,
      correlationId: input.correlationId,
      data: input.data,
    };
    await this.store.add(event, tx);
    return event;
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.type) ?? [];
    for (const handler of list) {
      await handler(event);
    }
  }
}

export interface RelayOptions {
  batchSize?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * Relais de l'outbox : un événement n'est marqué publié qu'après succès de TOUS ses abonnés.
 * Les abonnés doivent être idempotents (déduplication par eventId) : la livraison est « au moins une fois ».
 */
export class OutboxRelay {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly store: OutboxStore,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly options: RelayOptions = {},
  ) {}

  async tick(now = new Date()): Promise<number> {
    const batch = await this.store.claimPending(this.options.batchSize ?? 50, now);
    for (const event of batch) {
      try {
        await this.bus.dispatch(event);
        await this.store.markPublished(event.eventId, new Date());
      } catch (err) {
        const attempts = event.attempts + 1;
        const giveUp = attempts >= (this.options.maxAttempts ?? 10);
        const delay = (this.options.baseDelayMs ?? 5000) * 2 ** Math.min(attempts, 10);
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error({ eventId: event.eventId, type: event.type, attempts, giveUp }, 'échec de distribution');
        await this.store.markFailed(event.eventId, message, new Date(now.getTime() + delay), giveUp);
      }
    }
    return batch.length;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.tick()
        .catch((err) => this.logger.error({ err }, 'erreur du relais outbox'))
        .finally(() => {
          this.running = false;
        });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** Implémentation en mémoire (tests et développement sans base). */
export class InMemoryOutboxStore implements OutboxStore {
  readonly rows = new Map<
    string,
    { event: DomainEvent; status: 'PENDING' | 'PUBLISHED' | 'FAILED'; attempts: number; availableAt: Date; error?: string }
  >();

  async add(event: DomainEvent): Promise<void> {
    this.rows.set(event.eventId, { event, status: 'PENDING', attempts: 0, availableAt: new Date(0) });
  }

  async claimPending(limit: number, now: Date): Promise<StoredEvent[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === 'PENDING' && r.availableAt <= now)
      .slice(0, limit)
      .map((r) => ({ ...r.event, attempts: r.attempts }));
  }

  async markPublished(eventId: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) row.status = 'PUBLISHED';
  }

  async markFailed(eventId: string, error: string, nextAttemptAt: Date, giveUp: boolean): Promise<void> {
    const row = this.rows.get(eventId);
    if (!row) return;
    row.attempts += 1;
    row.error = error;
    row.availableAt = nextAttemptAt;
    row.status = giveUp ? 'FAILED' : 'PENDING';
  }
}
