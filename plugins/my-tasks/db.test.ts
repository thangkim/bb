import { createHash } from "node:crypto";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  createTasksStore,
  type CreatePresetInput,
  TasksPageCursorError,
} from "./db";
import { TASKS_SCHEMA_MIGRATIONS } from "./db/schema";

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks-db-test" });
  const db = bb.storage.database();
  return { db, harness, store: createTasksStore(db) };
}

function createProject(
  store: ReturnType<typeof createTasksStore>,
  prefix: string,
) {
  return store.createProject({
    name: `${prefix} project`,
    prefix,
    color: "blue",
  });
}

function cursorForEmptyArrayFilter(
  cursor: string,
  projectId: string,
  filter: "statuses" | "priorities" | "labelIds",
): string {
  const decoded: unknown = JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  );
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("expected an object cursor fixture");
  }
  const normalized = JSON.stringify({
    projectId,
    statuses: filter === "statuses" ? [] : null,
    priorities: filter === "priorities" ? [] : null,
    labelIds: filter === "labelIds" ? [] : null,
    activeOnly: false,
    search: null,
    sort: "manual",
  });
  const query = createHash("sha256").update(normalized).digest("base64url");
  return Buffer.from(JSON.stringify({ ...decoded, query }), "utf8").toString(
    "base64url",
  );
}

describe("tasks storage", () => {
  it("initializes its versioned schema idempotently", async () => {
    const { db, harness } = setup();
    try {
      createTasksStore(db);
      expect(
        db
          .prepare<[], { count: number }>(
            "SELECT COUNT(*) AS count FROM schema_version",
          )
          .get()?.count,
      ).toBe(TASKS_SCHEMA_MIGRATIONS.length);
    } finally {
      await harness.dispose();
    }
  });

  it("migrates existing presets to the project-default environment", async () => {
    const { db, harness } = setup();
    try {
      db.exec(`
        DELETE FROM schema_version WHERE version IN (3, 6);
        DROP TABLE presets;
        CREATE TABLE presets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          reasoning_level TEXT NOT NULL,
          permission_mode TEXT NOT NULL,
          instructions TEXT NOT NULL,
          builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
          created_at TEXT NOT NULL
        );
        INSERT INTO presets (
          id, name, provider_id, model_id, reasoning_level, permission_mode,
          instructions, builtin, created_at
        ) VALUES (
          '01J00000000000000000000000', 'Legacy', 'codex', 'gpt-5', 'high',
          'full', '', 0, '2026-07-15T00:00:00.000Z'
        );
      `);

      const migrated = createTasksStore(db).getPreset(
        "01J00000000000000000000000",
      );

      expect(migrated).toMatchObject({
        environmentKind: "project-default",
        baseBranch: null,
        machineId: null,
        serviceTier: null,
      });
    } finally {
      await harness.dispose();
    }
  });

  it("migrates retired preset permission modes to Accept Edits", async () => {
    const { db, harness } = setup();
    try {
      db.exec(`
        DELETE FROM schema_version WHERE version = 5;
        INSERT INTO presets (
          id, name, provider_id, model_id, reasoning_level, permission_mode,
          instructions, builtin, created_at
        ) VALUES
          (
            '01J00000000000000000000001', 'Legacy readonly', 'codex',
            'gpt-5', 'high', 'readonly', '', 0,
            '2026-07-15T00:00:00.000Z'
          ),
          (
            '01J00000000000000000000002', 'Legacy workspace', 'codex',
            'gpt-5', 'high', 'workspace-write', '', 0,
            '2026-07-15T00:00:00.000Z'
          );
      `);

      const modes = createTasksStore(db)
        .listPresets()
        .filter((preset) => preset.name.startsWith("Legacy "))
        .map((preset) => preset.permissionMode);

      expect(modes).toEqual(["accept-edits", "accept-edits"]);
    } finally {
      await harness.dispose();
    }
  });

  it("normalizes legacy image flags to the safe raster MIME allowlist", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "IMG");
      const task = store.createTask({
        projectId: project.id,
        title: "Legacy attachment",
      });
      const svg = store.createAttachment({
        taskId: task.id,
        fileName: "active.svg",
        mime: "image/svg+xml",
        sizeBytes: 1,
        blobPath: "blobs/svg/active.svg",
        isImage: true,
      });
      const png = store.createAttachment({
        taskId: task.id,
        fileName: "safe.png",
        mime: "image/png",
        sizeBytes: 1,
        blobPath: "blobs/png/safe.png",
        isImage: false,
      });
      db.prepare("DELETE FROM schema_version WHERE version = 2").run();

      createTasksStore(db);

      expect(store.getAttachment(svg.id)?.isImage).toBe(false);
      expect(store.getAttachment(png.id)?.isImage).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it("reports what a folder delete unfiled and nothing for a missing folder", async () => {
    const { harness, store } = setup();
    try {
      const parent = store.createFolder({ name: "Parent" });
      const child = store.createFolder({
        name: "Child",
        parentFolderId: parent.id,
      });
      const other = store.createFolder({ name: "Other" });
      const filed = store.createProject({
        name: "Filed",
        prefix: "FIL",
        color: "blue",
        folderId: parent.id,
      });
      const elsewhere = store.createProject({
        name: "Elsewhere",
        prefix: "ELS",
        color: "blue",
        folderId: other.id,
      });
      const task = store.createTask({
        projectId: filed.id,
        title: "Survives",
      });

      expect(store.deleteFolder(parent.id)).toEqual({
        deleted: true,
        movedProjectIds: [filed.id],
        movedFolderIds: [child.id],
      });
      expect(store.getFolder(child.id)?.parentFolderId).toBeNull();
      expect(store.getProject(filed.id)?.folderId).toBeNull();
      expect(store.getProject(elsewhere.id)?.folderId).toBe(other.id);
      expect(store.getTask(task.id)?.projectId).toBe(filed.id);

      expect(store.deleteFolder(parent.id)).toEqual({
        deleted: false,
        movedProjectIds: [],
        movedFolderIds: [],
      });
    } finally {
      await harness.dispose();
    }
  });

  it("allocates sequential per-project task keys transactionally", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "TSK");
      const first = store.createTask({ projectId: project.id, title: "First" });
      const second = store.createTask({
        projectId: project.id,
        title: "Second",
      });

      expect([first.key, second.key]).toEqual(["TSK-1", "TSK-2"]);
      expect(store.getProject(project.id)?.nextTaskNumber).toBe(3);
    } finally {
      await harness.dispose();
    }
  });

  it("turns sub-tasks into checklist tasks and derives project status on upgrade", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks-db-migration-test",
    });
    const db = bb.storage.database();
    try {
      db.pragma("foreign_keys = ON");
      db.exec(`
        CREATE TABLE schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      const record = db.prepare<[number]>(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, '2026-07-15')",
      );
      TASKS_SCHEMA_MIGRATIONS.slice(0, 6).forEach((sql, index) => {
        db.exec(sql);
        record.run(index + 1);
      });
      db.exec(`
        INSERT INTO projects (id, name, prefix, next_task_number, color, created_at) VALUES
          ('01J0000000000000000000000A', 'Active', 'ACT', 6, 'blue', '2026-07-15'),
          ('01J0000000000000000000000B', 'Finished', 'FIN', 3, 'blue', '2026-07-15'),
          ('01J0000000000000000000000C', 'Planned', 'PLN', 2, 'blue', '2026-07-15'),
          ('01J0000000000000000000000D', 'Empty', 'EMP', 1, 'blue', '2026-07-15');
        INSERT INTO tasks (id, project_id, number, title, status, priority, parent_task_id, position, created_at, updated_at) VALUES
          ('01J000000000000000000000A1', '01J0000000000000000000000A', 1, 'Parent', 'in_progress', 'high', NULL, 1024, '2026-07-15', '2026-07-15'),
          ('01J000000000000000000000A2', '01J0000000000000000000000A', 2, 'Child', 'todo', 'none', '01J000000000000000000000A1', 1024, '2026-07-15', '2026-07-15'),
          ('01J000000000000000000000A3', '01J0000000000000000000000A', 3, 'Shipped', 'done', 'none', NULL, 1024, '2026-07-15', '2026-07-15'),
          ('01J000000000000000000000A4', '01J0000000000000000000000A', 4, 'Dropped', 'canceled', 'none', NULL, 1024, '2026-07-15', '2026-07-15'),
          ('01J000000000000000000000A5', '01J0000000000000000000000A', 5, 'Someday', 'backlog', 'none', NULL, 1024, '2026-07-15', '2026-07-15'),
          ('01J000000000000000000000B1', '01J0000000000000000000000B', 1, 'Done', 'done', 'none', NULL, 1024, '2026-07-15', '2026-07-15'),
          ('01J000000000000000000000B2', '01J0000000000000000000000B', 2, 'Canceled', 'canceled', 'none', NULL, 1024, '2026-07-15', '2026-07-15'),
          ('01J000000000000000000000C1', '01J0000000000000000000000C', 1, 'Open', 'todo', 'none', NULL, 1024, '2026-07-15', '2026-07-15');
      `);

      const store = createTasksStore(db);

      expect(
        store.listProjects().map((project) => [project.prefix, project.status]),
      ).toEqual([
        ["ACT", "in_progress"],
        ["EMP", "todo"],
        ["FIN", "done"],
        ["PLN", "todo"],
      ]);
      expect(
        store
          .listTasks({ projectId: "01J0000000000000000000000A" })
          .map((task) => [task.title, task.status]),
      ).toEqual([
        ["Parent", "todo"],
        ["Child", "todo"],
        ["Someday", "todo"],
        ["Shipped", "done"],
        ["Dropped", "done"],
      ]);
      expect(
        db
          .prepare<[], { count: number }>(
            "SELECT COUNT(*) AS count FROM tasks WHERE parent_task_id IS NOT NULL",
          )
          .get()?.count,
      ).toBe(0);
      expect(() =>
        db
          .prepare(
            "UPDATE tasks SET status = 'in_review' WHERE id = '01J000000000000000000000C1'",
          )
          .run(),
      ).toThrow("tasks are todo or done and have no parent");
    } finally {
      await harness.dispose();
    }
  });

  it("moves a task to another project with a new key, keeping its history", async () => {
    const { harness, store } = setup();
    try {
      const source = createProject(store, "SRC");
      const target = createProject(store, "DST");
      store.createTask({ projectId: target.id, title: "Already there" });
      const task = store.createTask({ projectId: source.id, title: "Move me" });
      const sourceLabel = store.createLabel({
        projectId: source.id,
        name: "Old",
        color: "red",
      });
      store.addTaskLabel(task.id, sourceLabel.id);
      store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "You",
        body: "History",
      });
      store.upsertTaskThread({
        taskId: task.id,
        threadId: "thr_moving",
        presetName: "Attached",
        title: "Worker",
        liveStatus: "working",
      });

      const moved = store.moveTaskToProject(task.id, target.id);

      expect(moved).toMatchObject({
        id: task.id,
        projectId: target.id,
        key: "DST-2",
        title: "Move me",
      });
      expect(store.getProject(target.id)?.nextTaskNumber).toBe(3);
      expect(store.getTaskByKey("SRC-1")).toBeUndefined();
      expect(store.listTaskLabels(task.id)).toEqual([]);
      expect(store.listComments(task.id).map((comment) => comment.body)).toEqual(
        ["History"],
      );
      expect(
        store.listTaskThreads(task.id).map((thread) => thread.threadId),
      ).toEqual(["thr_moving"]);
      expect(
        store.listTasks({ projectId: target.id }).map((entry) => entry.title),
      ).toEqual(["Already there", "Move me"]);
      expect(store.moveTaskToProject(task.id, target.id).key).toBe("DST-2");
    } finally {
      await harness.dispose();
    }
  });

  it("keeps a task's place when it is checked off", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "CHK");
      const first = store.createTask({ projectId: project.id, title: "First" });
      const second = store.createTask({
        projectId: project.id,
        title: "Second",
      });
      const third = store.createTask({ projectId: project.id, title: "Third" });

      store.updateTask(second.id, { status: "done" });

      expect(
        store
          .listTasks({ projectId: project.id })
          .map((task) => [task.title, task.status]),
      ).toEqual([
        ["First", "todo"],
        ["Second", "done"],
        ["Third", "todo"],
      ]);
      expect(store.getTask(second.id)?.position).toBe(second.position);
      expect(first.position < third.position).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it("combines status, label, and active-thread filters in SQL", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "FLT");
      const label = store.createLabel({
        projectId: project.id,
        name: "Bug",
        color: "red",
      });
      const active = store.createTask({
        projectId: project.id,
        title: "Active match",
        status: "todo",
        priority: "high",
      });
      const inactive = store.createTask({
        projectId: project.id,
        title: "Inactive",
        status: "todo",
        priority: "high",
      });
      const wrongStatus = store.createTask({
        projectId: project.id,
        title: "Done active",
        status: "done",
        priority: "high",
      });
      for (const task of [active, inactive, wrongStatus]) {
        store.addTaskLabel(task.id, label.id);
      }
      for (const task of [active, wrongStatus]) {
        store.upsertTaskThread({
          taskId: task.id,
          threadId: `thr_${task.number}`,
          presetName: "Default",
          title: task.title,
          liveStatus: "working",
        });
      }

      expect(
        store.listTasks({
          projectId: project.id,
          statuses: ["todo"],
          priorities: ["high"],
          labelIds: [label.id],
          activeOnly: true,
        }),
      ).toEqual([active]);
    } finally {
      await harness.dispose();
    }
  });

  it("finds all search terms without requiring their input order", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "SRC");
      const matching = store.createTask({
        projectId: project.id,
        title: "Deployment readiness review",
      });
      store.createTask({
        projectId: project.id,
        title: "Deployment schedule",
      });
      store.createTask({
        projectId: project.id,
        title: "Readiness checklist",
      });

      const matchingKeys = (search: string) =>
        store
          .listTasks({ projectId: project.id, search })
          .map((task) => task.key);

      expect(matchingKeys("deployment readiness")).toEqual([matching.key]);
      expect(matchingKeys("readiness deployment")).toEqual([matching.key]);
    } finally {
      await harness.dispose();
    }
  });

  it("traverses deterministic filtered and sorted keyset pages without gaps", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "PAG");
      const bug = store.createLabel({
        projectId: project.id,
        name: "Bug",
        color: "red",
      });
      const fixtures = [
        { title: "Low later", priority: "low" as const, dueDate: "2026-08-03" },
        { title: "Urgent undated", priority: "urgent" as const, dueDate: null },
        {
          title: "High soon",
          priority: "high" as const,
          dueDate: "2026-08-01",
        },
        {
          title: "High later",
          priority: "high" as const,
          dueDate: "2026-08-02",
        },
        {
          title: "Ignored",
          priority: "urgent" as const,
          dueDate: "2026-07-01",
        },
      ].map((fixture, index) =>
        store.createTask({
          projectId: project.id,
          title: fixture.title,
          status: index === 4 ? "done" : "todo",
          priority: fixture.priority,
          dueDate: fixture.dueDate,
        }),
      );
      for (const task of fixtures.slice(0, 4)) {
        store.addTaskLabel(task.id, bug.id);
      }

      const collect = (sort: "manual" | "priority" | "due") => {
        const keys: string[] = [];
        let cursor: string | undefined;
        do {
          const page = store.listTasksPage({
            projectId: project.id,
            statuses: ["todo"],
            priorities: ["urgent", "high", "low"],
            labelIds: [bug.id],
            search: "later",
            sort,
            limit: 1,
            ...(cursor === undefined ? {} : { cursor }),
          });
          keys.push(...page.tasks.map((task) => task.key));
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined);
        return keys;
      };

      expect(collect("manual")).toEqual([fixtures[0]!.key, fixtures[3]!.key]);
      expect(collect("priority")).toEqual([fixtures[3]!.key, fixtures[0]!.key]);
      expect(collect("due")).toEqual([fixtures[3]!.key, fixtures[0]!.key]);
    } finally {
      await harness.dispose();
    }
  });

  it("invalidates cursors after tasks are added, removed, reordered, or updated", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "MUT");
      const tasks = Array.from({ length: 5 }, (_, index) =>
        store.createTask({
          projectId: project.id,
          title: `Task ${index + 1}`,
          status: "todo",
        }),
      );
      const firstCursor = () => {
        const cursor = store.listTasksPage({
          projectId: project.id,
          limit: 2,
        }).nextCursor;
        expect(cursor).not.toBeNull();
        if (cursor === null) throw new Error("expected another task page");
        return cursor;
      };
      const expectStale = (cursor: string) => {
        try {
          store.listTasksPage({ projectId: project.id, limit: 2, cursor });
          throw new Error("expected stale cursor failure");
        } catch (error) {
          if (!(error instanceof TasksPageCursorError)) throw error;
          expect(error.code).toBe("stale_cursor");
        }
      };

      let cursor = firstCursor();
      store.createTask({
        projectId: project.id,
        title: "Added",
        status: "todo",
      });
      expectStale(cursor);

      cursor = firstCursor();
      store.deleteTask(tasks[4]!.id);
      expectStale(cursor);

      cursor = firstCursor();
      store.updateTask(tasks[3]!.id, { status: "done" });
      expectStale(cursor);

      cursor = firstCursor();
      store.updateTask(tasks[2]!.id, { title: "Updated" });
      expectStale(cursor);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects cursors reused with different filters or sorting", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "CUR");
      for (let index = 0; index < 3; index += 1) {
        store.createTask({
          projectId: project.id,
          title: `Task ${index + 1}`,
          status: "todo",
        });
      }
      const cursor = store.listTasksPage({
        projectId: project.id,
        statuses: ["todo"],
        limit: 1,
      }).nextCursor;
      if (cursor === null) throw new Error("expected another task page");

      expect(() =>
        store.listTasksPage({
          projectId: project.id,
          statuses: ["done"],
          limit: 1,
          cursor,
        }),
      ).toThrow("does not match the current filters");
      expect(() =>
        store.listTasksPage({
          projectId: project.id,
          statuses: ["todo"],
          sort: "due",
          limit: 1,
          cursor,
        }),
      ).toThrow("does not match --sort");
    } finally {
      await harness.dispose();
    }
  });

  it("validates invalid, mismatched, and stale cursors for empty array filters", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "EMP");
      for (let index = 0; index < 3; index += 1) {
        store.createTask({
          projectId: project.id,
          title: `Task ${index + 1}`,
          status: "todo",
        });
      }
      const cursor = store.listTasksPage({
        projectId: project.id,
        statuses: ["todo"],
        limit: 1,
      }).nextCursor;
      if (cursor === null) throw new Error("expected another task page");

      const filters = ["statuses", "priorities", "labelIds"] as const;
      const matchingCursors = new Map(
        filters.map((filter) => [
          filter,
          cursorForEmptyArrayFilter(cursor, project.id, filter),
        ]),
      );
      for (const filter of filters) {
        const emptyFilter = { [filter]: [] };
        expect(
          store.listTasksPage({
            projectId: project.id,
            ...emptyFilter,
            cursor: matchingCursors.get(filter),
          }),
        ).toEqual({ tasks: [], nextCursor: null });
        expect(() =>
          store.listTasksPage({
            projectId: project.id,
            ...emptyFilter,
            cursor: "not-a-cursor",
          }),
        ).toThrow("invalid task-list cursor");
        expect(() =>
          store.listTasksPage({
            projectId: project.id,
            ...emptyFilter,
            cursor,
          }),
        ).toThrow("does not match the current filters");
      }
      expect(() =>
        store.listTasksPage({
          projectId: project.id,
          statuses: [],
          limit: 0,
        }),
      ).toThrow("Task page limit must be an integer");

      store.createTask({
        projectId: project.id,
        title: "Mutation",
        status: "todo",
      });
      for (const filter of filters) {
        expect(() =>
          store.listTasksPage({
            projectId: project.id,
            [filter]: [],
            cursor: matchingCursors.get(filter),
          }),
        ).toThrow("task-list data changed after this cursor was issued");
      }
    } finally {
      await harness.dispose();
    }
  });

  it("orders projects within a status by fractional midpoints and renormalizes exhausted gaps", async () => {
    const { db, harness, store } = setup();
    try {
      const first = createProject(store, "ONE");
      const second = createProject(store, "TWO");
      const moved = store.createProject({
        name: "Moved",
        prefix: "MOV",
        color: "blue",
        status: "in_progress",
      });
      const setPosition = db.prepare<[number, string]>(
        "UPDATE projects SET position = ? WHERE id = ?",
      );
      setPosition.run(1, first.id);
      setPosition.run(1 + 1e-12, second.id);

      const reordered = store.moveProject(moved.id, {
        status: "todo",
        beforeProjectId: first.id,
        afterProjectId: second.id,
      });
      const column = store
        .listProjects()
        .filter((project) => project.status === "todo")
        .sort((left, right) => left.position - right.position);

      expect(column.map((project) => project.id)).toEqual([
        first.id,
        moved.id,
        second.id,
      ]);
      expect(column.map((project) => project.position)).toEqual([
        1024, 1536, 2048,
      ]);
      expect(reordered.position).toBe(1536);
      expect(() =>
        store.moveProject(first.id, {
          status: "done",
          beforeProjectId: second.id,
          afterProjectId: null,
        }),
      ).toThrow("Reorder neighbors must be in the destination status");
    } finally {
      await harness.dispose();
    }
  });

  it("appends a project to the end of its new status column", async () => {
    const { harness, store } = setup();
    try {
      const done = store.createProject({
        name: "Done already",
        prefix: "DNE",
        color: "blue",
        status: "done",
      });
      const project = createProject(store, "UPD");

      const updated = store.updateProject(project.id, {
        status: "done",
        priority: "high",
        dueDate: "2026-10-01",
        description: "Ship it",
      });

      expect(updated).toMatchObject({
        status: "done",
        priority: "high",
        dueDate: "2026-10-01",
        description: "Ship it",
      });
      expect(updated.position).toBeGreaterThan(done.position);
      expect(() =>
        store.updateProject(project.id, { dueDate: "2026-02-30" }),
      ).toThrow("dueDate must be a valid calendar date");
    } finally {
      await harness.dispose();
    }
  });

  it("lists task comments in chronological order", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "CMT");
      const task = store.createTask({ projectId: project.id, title: "Task" });
      const later = store.createComment({
        taskId: task.id,
        kind: "agent",
        authorName: "Agent",
        body: "Later",
      });
      const earlier = store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "Sawyer",
        body: "Earlier",
      });
      const setCreatedAt = db.prepare<[string, string]>(
        "UPDATE comments SET created_at = ? WHERE id = ?",
      );
      setCreatedAt.run("2026-07-15T10:00:00.000Z", later.id);
      setCreatedAt.run("2026-07-15T09:00:00.000Z", earlier.id);

      expect(
        store.listComments(task.id).map((comment) => comment.body),
      ).toEqual(["Earlier", "Later"]);
    } finally {
      await harness.dispose();
    }
  });

  it("lists live task threads before terminal ones, newest first", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "THR");
      const task = store.createTask({ projectId: project.id, title: "Work" });
      const setAttachedAt = db.prepare<[string, string]>(
        "UPDATE task_threads SET attached_at = ? WHERE id = ?",
      );
      const attach = (
        threadId: string,
        liveStatus: "idle" | "working" | "failed" | "completed",
        attachedAt: string,
      ) => {
        const row = store.upsertTaskThread({
          taskId: task.id,
          threadId,
          presetName: "Attached",
          title: threadId,
          liveStatus,
        });
        setAttachedAt.run(attachedAt, row.id);
      };
      attach("thr_dead_first", "failed", "2026-07-15T09:00:00.000Z");
      attach("thr_live_old", "idle", "2026-07-15T10:00:00.000Z");
      attach("thr_dead_later", "completed", "2026-07-15T11:00:00.000Z");
      attach("thr_live_new", "working", "2026-07-15T12:00:00.000Z");

      expect(
        store.listTaskThreads(task.id).map((thread) => thread.threadId),
      ).toEqual([
        "thr_live_new",
        "thr_live_old",
        "thr_dead_later",
        "thr_dead_first",
      ]);

      const detached = store.getTaskThreadByThreadId(task.id, "thr_dead_first");
      expect(store.deleteTaskThread(detached!.id)).toBe(true);
      expect(
        store.listTaskThreads(task.id).map((thread) => thread.threadId),
      ).toEqual(["thr_live_new", "thr_live_old", "thr_dead_later"]);
    } finally {
      await harness.dispose();
    }
  });

  it("batches attached threads across tasks in one call", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "RM");
      const withThreads = store.createTask({
        projectId: project.id,
        title: "Has threads",
      });
      const bare = store.createTask({
        projectId: project.id,
        title: "Has none",
      });
      store.upsertTaskThread({
        taskId: withThreads.id,
        threadId: "thr_done",
        presetName: "Attached",
        title: "Finished worker",
        liveStatus: "completed",
      });
      store.upsertTaskThread({
        taskId: withThreads.id,
        threadId: "thr_live",
        presetName: "Attached",
        title: "Live worker",
        liveStatus: "working",
      });

      const meta = store.taskRowMeta([withThreads.id, bare.id]);

      expect(
        meta.get(withThreads.id)?.threads.map((thread) => thread.threadId),
      ).toEqual(["thr_live", "thr_done"]);
      expect(meta.get(bare.id)).toEqual({ threads: [] });
    } finally {
      await harness.dispose();
    }
  });

  it("looks up the tasks and projects one thread is attached to", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "LNK");
      const other = createProject(store, "OTH");
      const linked = store.createTask({
        projectId: project.id,
        title: "Linked task",
      });
      const unlinked = store.createTask({
        projectId: other.id,
        title: "Different thread",
      });
      store.upsertTaskThread({
        taskId: linked.id,
        threadId: "thr_shared",
        presetName: "Attached",
        title: "Shared",
        liveStatus: "idle",
      });
      store.upsertTaskThread({
        taskId: unlinked.id,
        threadId: "thr_elsewhere",
        presetName: "Attached",
        title: "Elsewhere",
        liveStatus: "idle",
      });
      store.upsertProjectThread({
        projectId: other.id,
        threadId: "thr_shared",
        title: "Shared",
      });

      const tasks = store.listTasksByThreadId("thr_shared");
      expect(tasks.map((task) => [task.id, task.key])).toEqual([
        [linked.id, "LNK-1"],
      ]);
      expect(
        store.listProjectsByThreadId("thr_shared").map((item) => item.id),
      ).toEqual([other.id]);
      expect(store.listTasksByThreadId("thr_none")).toEqual([]);
      expect(store.listProjectsByThreadId("thr_none")).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("attaches, upserts, lists, and detaches project threads", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "PRJ");
      const other = createProject(store, "OPS");

      const attached = store.upsertProjectThread({
        projectId: project.id,
        threadId: "thr_worker",
        title: "Working on it",
      });
      expect(attached.projectId).toBe(project.id);
      expect(attached.threadId).toBe("thr_worker");
      expect(attached.title).toBe("Working on it");

      const upserted = store.upsertProjectThread({
        projectId: project.id,
        threadId: "thr_worker",
        title: "Renamed thread",
      });
      expect(upserted.id).toBe(attached.id);
      expect(upserted.title).toBe("Renamed thread");

      store.upsertProjectThread({
        projectId: other.id,
        threadId: "thr_other",
        title: "Unrelated project's thread",
      });

      expect(
        store.listProjectThreads(project.id).map((thread) => thread.threadId),
      ).toEqual(["thr_worker"]);
      expect(
        store.getProjectThreadByThreadId(project.id, "thr_worker"),
      ).toEqual(upserted);
      expect(
        store.getProjectThreadByThreadId(project.id, "thr_other"),
      ).toBeUndefined();

      expect(store.deleteProjectThread(upserted.id)).toBe(true);
      expect(store.listProjectThreads(project.id)).toEqual([]);
      expect(store.deleteProjectThread(upserted.id)).toBe(false);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects a project thread whose thread id is not thr_-prefixed", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "BAD");
      expect(() =>
        store.upsertProjectThread({
          projectId: project.id,
          threadId: "not-a-thread-id",
          title: "Invalid",
        }),
      ).toThrow();
    } finally {
      await harness.dispose();
    }
  });

  it("finds the latest agent comment by reply time and ignores other activity", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "LAR");
      const task = store.createTask({ projectId: project.id, title: "Task" });
      const latest = store.createComment({
        taskId: task.id,
        kind: "agent",
        authorName: "Latest responder",
        threadId: "thr_latest",
        body: "Latest agent reply",
      });
      const older = store.createComment({
        taskId: task.id,
        kind: "agent",
        authorName: "Older responder",
        threadId: "thr_older",
        body: "Older agent reply",
      });
      store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "Sawyer",
        body: "Newer user activity",
      });
      const setCreatedAt = db.prepare<[string, string]>(
        "UPDATE comments SET created_at = ? WHERE id = ?",
      );
      setCreatedAt.run("2026-07-15T10:00:00.000Z", older.id);
      setCreatedAt.run("2026-07-15T11:00:00.000Z", latest.id);

      expect(store.getLatestAgentComment(task.id, null)).toMatchObject({
        id: latest.id,
        threadId: "thr_latest",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("uses insertion order when agent replies share a timestamp", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "TIE");
      const task = store.createTask({ projectId: project.id, title: "Task" });
      const earlier = store.createComment({
        id: "01H00000000000000000000002",
        taskId: task.id,
        kind: "agent",
        authorName: "Earlier responder",
        threadId: "thr_earlier",
        body: "Earlier reply",
      });
      const later = store.createComment({
        id: "01H00000000000000000000001",
        taskId: task.id,
        kind: "agent",
        authorName: "Later responder",
        threadId: "thr_later",
        body: "Later reply",
      });
      const setCreatedAt = db.prepare<[string, string]>(
        "UPDATE comments SET created_at = ? WHERE id = ?",
      );
      const sharedTime = "2026-07-15T10:00:00.000Z";
      setCreatedAt.run(sharedTime, earlier.id);
      setCreatedAt.run(sharedTime, later.id);

      expect(store.listComments(task.id).map((comment) => comment.id)).toEqual([
        earlier.id,
        later.id,
      ]);
      expect(store.getLatestAgentComment(task.id, null)).toMatchObject({
        id: later.id,
        threadId: "thr_later",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("rejects duplicate preset names", async () => {
    const { harness, store } = setup();
    try {
      const preset: CreatePresetInput = {
        name: "Default",
        providerId: "openai",
        modelId: "gpt-5",
        reasoningLevel: "high",
        serviceTier: null,
        permissionMode: "accept-edits",
        environmentKind: "project-default",
        baseBranch: null,
        machineId: null,
        instructions: "Work the task.",
      };
      store.createPreset(preset);
      expect(() => store.createPreset(preset)).toThrow(
        /UNIQUE constraint failed: presets.name/,
      );
    } finally {
      await harness.dispose();
    }
  });
});
