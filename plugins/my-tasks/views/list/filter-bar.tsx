import type { ReactNode } from "react";
import {
  PRIORITIES,
  PROJECT_STATUSES,
  type Priority,
  type ProjectStatus,
} from "../../shared/contract.js";
import { TASK_SORTS, type TaskSort } from "../../shared/pagination.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { PriorityIcon, StatusIcon } from "./icons.js";
import { PRIORITY_LABELS, SORT_LABELS, STATUS_LABELS } from "./lib.js";

function toggled<T>(values: readonly T[], value: T, checked: boolean): T[] {
  if (checked) return values.includes(value) ? [...values] : [...values, value];
  return values.filter((existing) => existing !== value);
}

function chipTriggerClass(active: boolean): string {
  return cn(
    "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs max-md:pointer-coarse:h-8",
    active
      ? "border-border bg-secondary text-foreground"
      : "border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground",
  );
}

function FilterChip({
  icon,
  label,
  selectedNames,
  children,
}: {
  icon: IconName;
  label: string;
  selectedNames: readonly string[];
  children: ReactNode;
}) {
  const active = selectedNames.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipTriggerClass(active)}>
          <Icon name={icon} className="size-3" />
          {label}
          {active ? (
            <span className="font-medium tabular-nums">
              {selectedNames.length}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortChip({
  sort,
  onChange,
}: {
  sort: TaskSort;
  onChange: (sort: TaskSort) => void;
}) {
  const active = sort !== "manual";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipTriggerClass(active)}>
          <Icon name="Sort" className="size-3" />
          Sort
          {active ? (
            <span className="font-medium">{SORT_LABELS[sort]}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        mobileTitle="Sort projects"
      >
        {TASK_SORTS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={sort === option}
            onCheckedChange={(checked) => {
              if (checked === true) onChange(option);
            }}
          >
            {SORT_LABELS[option]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ListFilterState {
  statuses: ProjectStatus[];
  priorities: Priority[];
}

export const EMPTY_FILTERS: ListFilterState = {
  statuses: [],
  priorities: [],
};

export function hasActiveFilters(filters: ListFilterState): boolean {
  return filters.statuses.length > 0 || filters.priorities.length > 0;
}

export function ListFilterBar({
  filters,
  onChange,
  sort,
  onSortChange,
}: {
  filters: ListFilterState;
  onChange: (filters: ListFilterState) => void;
  sort: TaskSort;
  onSortChange: (sort: TaskSort) => void;
}) {
  const keepOpen = (event: Event) => event.preventDefault();
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-hairline px-3.5 py-1.5">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        <FilterChip
          icon="Circle"
          label="Status"
          selectedNames={filters.statuses.map(
            (status) => STATUS_LABELS[status],
          )}
        >
          {PROJECT_STATUSES.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={filters.statuses.includes(status)}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  statuses: toggled(filters.statuses, status, checked === true),
                })
              }
            >
              <span className="flex items-center gap-2">
                <StatusIcon status={status} className="size-3" />
                {STATUS_LABELS[status]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterChip>
        <FilterChip
          icon="ArrowUpDown"
          label="Priority"
          selectedNames={filters.priorities.map(
            (priority) => PRIORITY_LABELS[priority],
          )}
        >
          {PRIORITIES.map((priority) => (
            <DropdownMenuCheckboxItem
              key={priority}
              checked={filters.priorities.includes(priority)}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  priorities: toggled(
                    filters.priorities,
                    priority,
                    checked === true,
                  ),
                })
              }
            >
              <span className="flex items-center gap-2">
                <PriorityIcon priority={priority} className="size-3" />
                {PRIORITY_LABELS[priority]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterChip>
        {hasActiveFilters(filters) ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-input hover:text-foreground max-md:pointer-coarse:h-8"
          >
            <Icon name="X" className="size-3" />
            Clear
          </button>
        ) : null}
      </div>
      <SortChip sort={sort} onChange={onSortChange} />
    </div>
  );
}
