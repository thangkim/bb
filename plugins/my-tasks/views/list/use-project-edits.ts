import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectStatus } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { useTasksRpc } from "../../shell/data.js";
import type { ProjectEdit } from "./property-menus.js";

type ProjectPatch = ProjectEdit & { position?: number };

interface Override {
  patch: ProjectPatch;
  gen: number;
}

type Overrides = ReadonlyMap<string, Override>;

function applyPatch(project: Project, patch: ProjectPatch): Project {
  return { ...project, ...patch };
}

function settled(project: Project, patch: ProjectPatch): boolean {
  return (Object.keys(patch) as (keyof ProjectPatch)[]).every(
    (field) => project[field] === patch[field],
  );
}

export function reconcileProjectOverrides(
  overrides: Overrides,
  serverProjects: readonly Project[],
): Overrides {
  if (overrides.size === 0) return overrides;
  const byId = new Map(serverProjects.map((project) => [project.id, project]));
  const next = new Map<string, Override>();
  for (const [id, override] of overrides) {
    const server = byId.get(id);
    if (server && !settled(server, override.patch)) next.set(id, override);
  }
  return next.size === overrides.size ? overrides : next;
}

export function positionBetween(
  before: Project | undefined,
  after: Project | undefined,
  fallback: number,
): number {
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + 1024;
  if (after) return after.position / 2;
  return fallback;
}

export interface ProjectEditController {
  projects: Project[] | undefined;
  edit: (project: Project, patch: ProjectEdit) => void;
  complete: (project: Project) => void;
  move: (
    project: Project,
    status: ProjectStatus,
    before: Project | undefined,
    after: Project | undefined,
  ) => void;
  remove: (project: Project) => void;
}

export function useProjectEdits(
  serverProjects: readonly Project[] | undefined,
  onError: (message: string) => void,
): ProjectEditController {
  const rpc = useTasksRpc();
  const [overrides, setOverrides] = useState<Overrides>(() => new Map());
  const genRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (serverProjects === undefined) return;
    setOverrides((current) =>
      reconcileProjectOverrides(current, serverProjects),
    );
  }, [serverProjects]);

  const track = useCallback(
    (projectId: string, patch: ProjectPatch, request: Promise<Project>) => {
      const gen = (genRef.current += 1);
      setOverrides((current) => {
        const next = new Map(current);
        next.set(projectId, {
          patch: { ...current.get(projectId)?.patch, ...patch },
          gen,
        });
        return next;
      });
      const forget = () =>
        setOverrides((current) => {
          if (current.get(projectId)?.gen !== gen) return current;
          const next = new Map(current);
          next.delete(projectId);
          return next;
        });
      request.then(
        (project) =>
          setOverrides((current) => {
            const override = current.get(projectId);
            if (override?.gen !== gen) return current;
            const next = new Map(current);
            next.set(projectId, {
              gen,
              patch: {
                status: project.status,
                priority: project.priority,
                dueDate: project.dueDate,
                position: project.position,
              },
            });
            return next;
          }),
        (error: unknown) => {
          forget();
          onErrorRef.current(errorMessage(error));
        },
      );
    },
    [],
  );

  const edit = useCallback(
    (project: Project, patch: ProjectEdit) => {
      track(
        project.id,
        patch,
        rpc
          .call("updateProject", { projectId: project.id, ...patch })
          .then((result) => result.project),
      );
    },
    [rpc, track],
  );

  const complete = useCallback(
    (project: Project) => {
      track(
        project.id,
        { status: "done" },
        rpc
          .call("completeProject", { projectId: project.id })
          .then((result) => result.project),
      );
    },
    [rpc, track],
  );

  const move = useCallback(
    (
      project: Project,
      status: ProjectStatus,
      before: Project | undefined,
      after: Project | undefined,
    ) => {
      track(
        project.id,
        {
          status,
          position: positionBetween(before, after, Number.MAX_SAFE_INTEGER),
        },
        rpc
          .call("moveProject", {
            projectId: project.id,
            status,
            beforeProjectId: before?.id ?? null,
            afterProjectId: after?.id ?? null,
          })
          .then((result) => result.project),
      );
    },
    [rpc, track],
  );

  const remove = useCallback(
    (project: Project) => {
      void rpc
        .call("deleteProject", { projectId: project.id, force: true })
        .then(
          (result) => {
            if (!result.ok) onErrorRef.current(result.error.message);
          },
          (error: unknown) => onErrorRef.current(errorMessage(error)),
        );
    },
    [rpc],
  );

  const projects = useMemo(() => {
    if (serverProjects === undefined) return undefined;
    if (overrides.size === 0) return [...serverProjects];
    return serverProjects.map((project) => {
      const override = overrides.get(project.id);
      return override ? applyPatch(project, override.patch) : project;
    });
  }, [serverProjects, overrides]);

  return { projects, edit, complete, move, remove };
}
