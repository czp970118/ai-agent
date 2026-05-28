"use client";

import { ListBox, ListBoxItem, Select } from "@heroui/react";
import { adminFormStyles as ui } from "../components/formStyles";

type PaginationPageSizeSelectProps = {
  value: number;
  options: number[];
  disabled?: boolean;
  onChange: (value: number) => void;
};

export default function PaginationPageSizeSelect({
  value,
  options,
  disabled,
  onChange,
}: PaginationPageSizeSelectProps) {
  return (
    <Select
      aria-label="每页条数"
      variant="secondary"
      selectedKey={String(value)}
      isDisabled={disabled}
      onSelectionChange={(key) => {
        if (key == null) return;
        onChange(Number(key));
      }}
    >
      <Select.Trigger
        className={`${ui.inputControl} h-8 min-h-8 w-[7.5rem] shrink-0 !py-0 text-xs data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-slate-200 dark:data-[focus-visible=true]:ring-slate-800`}
      >
        <Select.Value className="text-xs" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox aria-label="每页条数选项">
          {options.map((n) => (
            <ListBoxItem key={String(n)} id={String(n)}>
              {n} 条/页
            </ListBoxItem>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
