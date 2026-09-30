import {
  PRIORITIES,
  PROJECT_STATUSES,
  type Priority,
  type ProjectStatus,
} from "../../shared/contract.js";
import { TASK_SORTS, type TaskSort } from "../../shared/pagination.js";
import { EMPTY_FILTERS, type ListFilterState } from "./filter-bar.js";

export const LIST_PREFERENCE_STORAGE_KEY = "bb-my-tasks:project-list-preferences";
export const LIST_PREFERENCE_VERSION = 1 as const;

export type ListPreferenceScope = "all" | "active";

export interface ListPreference {
  filters: ListFilterState;
  sort: TaskSort;
}

export const DEFAULT_LIST_PREFERENCE: ListPreference = {
  filters: EMPTY_FILTERS,
  sort: "manual",
};

interface StoredDocumentV1 {
  version: typeof LIST_PREFERENCE_VERSION;
  scopes: Record<string, unknown>;
}

const STATUS_SET = new Set<string>(PROJECT_STATUSES);
const PRIORITY_SET = new Set<string>(PRIORITIES);
const SORT_SET = new Set<string>(TASK_SORTS);

function uniqueValidValues<T extends string>(
  values: unknown,
  allowed: ReadonlySet<string>,
): T[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !allowed.has(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value as T);
  }
  return result;
}

function sanitizeSort(value: unknown): TaskSort {
  if (typeof value === "string" && SORT_SET.has(value)) {
    return value as TaskSort;
  }
  return DEFAULT_LIST_PREFERENCE.sort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeListPreference(raw: unknown): ListPreference {
  if (!isRecord(raw)) {
    return { filters: { ...EMPTY_FILTERS }, sort: DEFAULT_LIST_PREFERENCE.sort };
  }
  const filtersRaw = isRecord(raw.filters) ? raw.filters : {};
  return {
    filters: {
      statuses: uniqueValidValues<ProjectStatus>(
        filtersRaw.statuses,
        STATUS_SET,
      ),
      priorities: uniqueValidValues<Priority>(
        filtersRaw.priorities,
        PRIORITY_SET,
      ),
    },
    sort: sanitizeSort(raw.sort),
  };
}

interface ParsedStorage {
  scopes: Record<string, unknown>;
  isFutureVersion: boolean;
}

function readStorage(): ParsedStorage | null {
  try {
    const raw = window.localStorage.getItem(LIST_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.scopes)) return null;
    const version =
      typeof parsed.version === "number" && Number.isFinite(parsed.version)
        ? parsed.version
        : null;
    if (version !== null && version < LIST_PREFERENCE_VERSION) return null;
    return {
      scopes: parsed.scopes,
      isFutureVersion: version !== null && version > LIST_PREFERENCE_VERSION,
    };
  } catch {
    return null;
  }
}

export function loadListPreference(scope: ListPreferenceScope): ListPreference {
  const document = readStorage();
  return sanitizeListPreference(document?.scopes[scope]);
}

export function storeListPreference(
  scope: ListPreferenceScope,
  preference: ListPreference,
): void {
  const sanitized = sanitizeListPreference(preference);
  try {
    const existing = readStorage();
    if (existing?.isFutureVersion) return;
    const document: StoredDocumentV1 = {
      version: LIST_PREFERENCE_VERSION,
      scopes: { ...(existing?.scopes ?? {}), [scope]: sanitized },
    };
    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify(document),
    );
  } catch {}
}
