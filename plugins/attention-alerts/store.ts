import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { alertKindSchema, type Alert, type AlertKind } from "./contract.js";

const MIGRATIONS = [
  `CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    project_id TEXT,
    interaction_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_rung_at INTEGER NOT NULL
  )`,
  `CREATE INDEX alerts_thread ON alerts(thread_id)`,
  `CREATE UNIQUE INDEX alerts_interaction ON alerts(interaction_id) WHERE interaction_id IS NOT NULL`,
  `CREATE TABLE alerts_next (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    project_id TEXT,
    interaction_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    created_at INTEGER NOT NULL,
    last_rung_at INTEGER NOT NULL
  )`,
  `INSERT INTO alerts_next SELECT id, thread_id, project_id, interaction_id, kind, title, body, created_at, last_rung_at FROM alerts ORDER BY rowid`,
  `DROP TABLE alerts`,
  `ALTER TABLE alerts_next RENAME TO alerts`,
  `CREATE INDEX alerts_thread ON alerts(thread_id)`,
  `CREATE UNIQUE INDEX alerts_interaction ON alerts(interaction_id) WHERE interaction_id IS NOT NULL`,
];

const rowSchema = z.object({
  id: z.string(),
  thread_id: z.string().nullable(),
  project_id: z.string().nullable(),
  interaction_id: z.string().nullable(),
  kind: alertKindSchema,
  title: z.string(),
  body: z.string().nullable(),
  created_at: z.number().int(),
});

function toAlert(row: unknown): Alert {
  const parsed = rowSchema.parse(row);
  return {
    id: parsed.id,
    threadId: parsed.thread_id,
    projectId: parsed.project_id,
    interactionId: parsed.interaction_id,
    kind: parsed.kind,
    title: parsed.title,
    body: parsed.body,
    createdAt: parsed.created_at,
  };
}

const idRowSchema = z.object({ id: z.string() });
const threadRowSchema = z.object({ thread_id: z.string() });

export type AlertStore = ReturnType<typeof createAlertStore>;

export function createAlertStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const selectColumns =
    "id, thread_id, project_id, interaction_id, kind, title, body, created_at";

  function placeholders(count: number): string {
    return Array.from({ length: count }, () => "?").join(", ");
  }

  return {
    list(): Alert[] {
      return db
        .prepare(
          `SELECT ${selectColumns} FROM alerts ORDER BY created_at DESC, rowid DESC`,
        )
        .all()
        .map(toAlert);
    },

    get(id: string): Alert | null {
      const row = db
        .prepare(`SELECT ${selectColumns} FROM alerts WHERE id = ?`)
        .get(id);
      return row === undefined ? null : toAlert(row);
    },

    insert(alert: Alert): boolean {
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO alerts
            (id, thread_id, project_id, interaction_id, kind, title, body, created_at, last_rung_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          alert.id,
          alert.threadId,
          alert.projectId,
          alert.interactionId,
          alert.kind,
          alert.title,
          alert.body,
          alert.createdAt,
          alert.createdAt,
        );
      return result.changes > 0;
    },

    remove(id: string): boolean {
      return db.prepare(`DELETE FROM alerts WHERE id = ?`).run(id).changes > 0;
    },

    removeAll(): number {
      return db.prepare(`DELETE FROM alerts`).run().changes;
    },

    removeForThread(threadId: string, kinds: readonly AlertKind[]): string[] {
      if (kinds.length === 0) return [];
      return db
        .prepare(
          `DELETE FROM alerts WHERE thread_id = ? AND kind IN (${placeholders(kinds.length)}) RETURNING id`,
        )
        .all(threadId, ...kinds)
        .map((row) => idRowSchema.parse(row).id);
    },

    removeAllForThread(threadId: string): string[] {
      return db
        .prepare(`DELETE FROM alerts WHERE thread_id = ? RETURNING id`)
        .all(threadId)
        .map((row) => idRowSchema.parse(row).id);
    },

    listInteractionAlerts(threadId: string): Alert[] {
      return db
        .prepare(
          `SELECT ${selectColumns} FROM alerts WHERE thread_id = ? AND interaction_id IS NOT NULL`,
        )
        .all(threadId)
        .map(toAlert);
    },

    threadIds(): string[] {
      return db
        .prepare(
          `SELECT DISTINCT thread_id FROM alerts WHERE thread_id IS NOT NULL`,
        )
        .all()
        .map((row) => threadRowSchema.parse(row).thread_id);
    },

    dueForReminder(kinds: readonly AlertKind[], rungBefore: number): Alert[] {
      if (kinds.length === 0) return [];
      return db
        .prepare(
          `SELECT ${selectColumns} FROM alerts
           WHERE kind IN (${placeholders(kinds.length)}) AND last_rung_at <= ?
           ORDER BY created_at DESC`,
        )
        .all(...kinds, rungBefore)
        .map(toAlert);
    },

    markRung(ids: readonly string[], at: number): void {
      if (ids.length === 0) return;
      db.prepare(
        `UPDATE alerts SET last_rung_at = ? WHERE id IN (${placeholders(ids.length)})`,
      ).run(at, ...ids);
    },
  };
}
