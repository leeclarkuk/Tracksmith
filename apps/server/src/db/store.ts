import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  AuditEntry,
  Column,
  CreateCardInput,
  Engine,
  EvidenceItem,
  GoalContract,
  OutcomeCard,
  ResultPacket,
  RunRef,
} from '@tracksmith/shared';
import { deriveTitleSummary } from '@tracksmith/shared';
import fs from 'node:fs';
import path from 'node:path';

interface CardRow {
  id: string;
  column: Column;
  prompt: string;
  title: string;
  summary: string;
  engine: Engine;
  resolved_engine: string | null;
  run_ref: string | null;
  goal_contract: string | null;
  result_packet: string | null;
  evidence: string;
  audit: string;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToCard(row: CardRow): OutcomeCard {
  return {
    id: row.id,
    column: row.column,
    prompt: row.prompt,
    title: row.title,
    summary: row.summary,
    engine: row.engine,
    resolvedEngine: row.resolved_engine as OutcomeCard['resolvedEngine'],
    runRef: parseJson<RunRef | undefined>(row.run_ref, undefined),
    goalContract: parseJson<GoalContract | undefined>(row.goal_contract, undefined),
    resultPacket: parseJson<ResultPacket | undefined>(row.result_packet, undefined),
    evidence: parseJson<EvidenceItem[]>(row.evidence, []),
    audit: parseJson<AuditEntry[]>(row.audit, []),
    failureReason: row.failure_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settledAt: row.settled_at ?? undefined,
  };
}

export class CardStore {
  private db: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        column TEXT NOT NULL,
        prompt TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        engine TEXT NOT NULL,
        resolved_engine TEXT,
        run_ref TEXT,
        goal_contract TEXT,
        result_packet TEXT,
        evidence TEXT NOT NULL DEFAULT '[]',
        audit TEXT NOT NULL DEFAULT '[]',
        failure_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        settled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column);
    `);
  }

  list(): OutcomeCard[] {
    const rows = this.db.prepare('SELECT * FROM cards ORDER BY updated_at DESC').all() as CardRow[];
    return rows.map(rowToCard);
  }

  get(id: string): OutcomeCard | undefined {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
    return row ? rowToCard(row) : undefined;
  }

  getRunning(): OutcomeCard[] {
    const rows = this.db.prepare("SELECT * FROM cards WHERE column = 'running'").all() as CardRow[];
    return rows.map(rowToCard);
  }

  findByRunRef(kind: string, id: string): OutcomeCard | undefined {
    const cards = this.list();
    return cards.find((c) => {
      if (!c.runRef) return false;
      if (kind === 'chat') return c.runRef.slotId === id;
      if (kind === 'task_runner') return c.runRef.taskId === id;
      return false;
    });
  }

  create(input: CreateCardInput, title?: string, summary?: string): OutcomeCard {
    const derived = deriveTitleSummary(input.prompt);
    const now = new Date().toISOString();
    const id = nanoid();
    const audit: AuditEntry[] = [{ id: nanoid(), at: now, kind: 'created', message: `Card created in ${input.column ?? 'todo'}` }];
    const goalContract = input.goalContract
      ? { ...input.goalContract, attemptCount: 0, tokenUsed: 0 }
      : undefined;

    const card: OutcomeCard = {
      id,
      column: input.column ?? 'todo',
      prompt: input.prompt.trim(),
      title: title ?? derived.title,
      summary: summary ?? derived.summary,
      engine: input.engine,
      evidence: [],
      audit,
      goalContract,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO cards (id, column, prompt, title, summary, engine, resolved_engine, run_ref, goal_contract, result_packet, evidence, audit, failure_reason, created_at, updated_at, settled_at)
      VALUES (@id, @column, @prompt, @title, @summary, @engine, @resolvedEngine, @runRef, @goalContract, @resultPacket, @evidence, @audit, @failureReason, @createdAt, @updatedAt, @settledAt)
    `).run({
      id: card.id,
      column: card.column,
      prompt: card.prompt,
      title: card.title,
      summary: card.summary,
      engine: card.engine,
      resolvedEngine: card.resolvedEngine ?? null,
      runRef: card.runRef ? JSON.stringify(card.runRef) : null,
      goalContract: card.goalContract ? JSON.stringify(card.goalContract) : null,
      resultPacket: card.resultPacket ? JSON.stringify(card.resultPacket) : null,
      evidence: JSON.stringify(card.evidence),
      audit: JSON.stringify(card.audit),
      failureReason: card.failureReason ?? null,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      settledAt: card.settledAt ?? null,
    });

    return card;
  }

  save(card: OutcomeCard): OutcomeCard {
    const now = new Date().toISOString();
    card.updatedAt = now;
    this.db.prepare(`
      UPDATE cards SET
        column = @column,
        prompt = @prompt,
        title = @title,
        summary = @summary,
        engine = @engine,
        resolved_engine = @resolvedEngine,
        run_ref = @runRef,
        goal_contract = @goalContract,
        result_packet = @resultPacket,
        evidence = @evidence,
        audit = @audit,
        failure_reason = @failureReason,
        updated_at = @updatedAt,
        settled_at = @settledAt
      WHERE id = @id
    `).run({
      id: card.id,
      column: card.column,
      prompt: card.prompt,
      title: card.title,
      summary: card.summary,
      engine: card.engine,
      resolvedEngine: card.resolvedEngine ?? null,
      runRef: card.runRef ? JSON.stringify(card.runRef) : null,
      goalContract: card.goalContract ? JSON.stringify(card.goalContract) : null,
      resultPacket: card.resultPacket ? JSON.stringify(card.resultPacket) : null,
      evidence: JSON.stringify(card.evidence),
      audit: JSON.stringify(card.audit),
      failureReason: card.failureReason ?? null,
      updatedAt: card.updatedAt,
      settledAt: card.settledAt ?? null,
    });
    return card;
  }

  appendAudit(card: OutcomeCard, kind: AuditEntry['kind'], message: string): OutcomeCard {
    card.audit = [...card.audit, { id: nanoid(), at: new Date().toISOString(), kind, message }];
    return this.save(card);
  }

  appendEvidence(card: OutcomeCard, item: Omit<EvidenceItem, 'id' | 'createdAt'>): OutcomeCard {
    card.evidence = [...card.evidence, { ...item, id: nanoid(), createdAt: new Date().toISOString() }];
    return this.save(card);
  }

  private locks = new Map<string, Promise<void>>();

  async mutate(id: string, fn: (card: OutcomeCard) => Promise<OutcomeCard | null> | OutcomeCard | null): Promise<OutcomeCard | null> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let result: OutcomeCard | null = null;
    const next = prev.then(async () => {
      const card = this.get(id);
      if (!card) return;
      const updated = await fn({ ...card, evidence: [...card.evidence], audit: [...card.audit] });
      if (updated) result = this.save(updated);
    });
    this.locks.set(id, next.then(() => undefined).catch(() => undefined));
    await next;
    return result;
  }
}
