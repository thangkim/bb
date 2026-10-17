import type { ReactNode } from "react";
import {
  PRIORITIES,
  PROJECT_STATUSES,
  type Priority,
  type ProjectStatus,
} from "../../shared/contract.js";
import { TASK_SORTS, type TaskSort } from "../../shared/pagination.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon, type IconName } from "@/components/ui/icon";
import { PriorityIcon, StatusIcon } from "./icons.js";
import { PRIORITY_LABELS, SORT_LABELS, STATUS_LABELS } from "./lib.js";

function toggled<T>(values: readonly T[], value: T, checked: boolean): T[] {
  if (checked) return values.includes(value) ? [...values] : [...values, value];
  return values.filter((existing) => existing !== value);
}

const keepOpen = (event: Event) => event.preventDefault();

function FilterSubmenu({
  icon,
  label,
  count,
  children,
}: {
  icon: IconName;
  label: string;
  count: number;
  children: ReactNode;
}) {
  if (useIsCompactViewport()) {
    return (
      <>
        <DropdownMenuLabel className="flex items-center gap-2">
          <Icon name={icon} className="size-3.5" />
          {label}
        </DropdownMenuLabel>
        {children}
      </>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name={icon} className="size-3.5" />
        <span>{label}</span>
        {count > 0 ? (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-44">
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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

export function ListFilterMenu({
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
  const filtering = hasActiveFilters(filters);
  const active = filtering || sort !== "manual";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-6 shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground max-md:pointer-coarse:size-9"
          aria-label="Filter and sort"
        >
          <Icon name="Filter" className="size-4" />
          {active ? (
            <span
              aria-hidden
              className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        mobileTitle="Filter projects"
      >
        <FilterSubmenu
          icon="Circle"
          label="Status"
          count={filters.statuses.length}
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
        </FilterSubmenu>
        <FilterSubmenu
          icon="ArrowUpDown"
          label="Priority"
          count={filters.priorities.length}
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
        </FilterSubmenu>
        <FilterSubmenu
          icon="Sort"
          label="Sort"
          count={sort !== "manual" ? 1 : 0}
        >
          {TASK_SORTS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={sort === option}
              onCheckedChange={(checked) => {
                if (checked === true) onSortChange(option);
              }}
            >
              {SORT_LABELS[option]}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterSubmenu>
        {filtering ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(EMPTY_FILTERS)}>
              <Icon name="X" className="size-3.5" />
              <span>Clear filters</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
