import { useState, type ComponentType, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  calendarMonthOf,
  calendarWeeks,
  localIsoDate,
  shiftCalendarMonth,
} from "./lib.js";

type MenuItemComponent = ComponentType<{
  className?: string;
  onSelect?: (event: Event) => void;
  "aria-label"?: string;
  "aria-current"?: "date" | undefined;
  "aria-selected"?: boolean;
  children?: ReactNode;
}>;

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const keepOpen = (event: Event) => event.preventDefault();

export function DueDateCalendar({
  dueDate,
  onChange,
  Item,
}: {
  dueDate: string | null;
  onChange: (dueDate: string) => void;
  Item: MenuItemComponent;
}) {
  const today = localIsoDate(0);
  const [month, setMonth] = useState(() => calendarMonthOf(dueDate ?? today));
  const title = new Date(month.year, month.month, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  return (
    <div className="px-1 pb-1">
      <div className="flex items-center gap-1 py-1">
        <span className="flex-1 px-1 text-xs font-medium">{title}</span>
        <Item
          aria-label="Previous month"
          className="size-6 justify-center p-0"
          onSelect={(event) => {
            keepOpen(event);
            setMonth((current) => shiftCalendarMonth(current, -1));
          }}
        >
          <Icon name="ChevronLeft" className="size-3.5" />
        </Item>
        <Item
          aria-label="Next month"
          className="size-6 justify-center p-0"
          onSelect={(event) => {
            keepOpen(event);
            setMonth((current) => shiftCalendarMonth(current, 1));
          }}
        >
          <Icon name="ChevronRight" className="size-3.5" />
        </Item>
      </div>
      <div className="grid grid-cols-7 gap-px" role="grid" aria-label={title}>
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="flex h-6 items-center justify-center text-2xs text-subtle-foreground"
          >
            {weekday}
          </span>
        ))}
        {calendarWeeks(month)
          .flat()
          .map((day) => {
            const selected = day.iso === dueDate;
            return (
              <Item
                key={day.iso}
                aria-label={new Date(`${day.iso}T00:00:00`).toLocaleDateString(
                  "en-US",
                  { weekday: "long", month: "long", day: "numeric" },
                )}
                aria-selected={selected}
                aria-current={day.iso === today ? "date" : undefined}
                className={cn(
                  "h-7 justify-center p-0 tabular-nums",
                  !day.inMonth && "text-subtle-foreground",
                  day.iso === today &&
                    "font-semibold text-foreground underline underline-offset-2",
                  selected &&
                    "bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                )}
                onSelect={() => onChange(day.iso)}
              >
                {day.day}
              </Item>
            );
          })}
      </div>
    </div>
  );
}
