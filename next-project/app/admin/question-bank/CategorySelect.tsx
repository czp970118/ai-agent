"use client";

import { ListBox, ListBoxItem, Select } from "@heroui/react";
import { adminFormStyles as ui } from "../components/formStyles";

export type CategoryOption = { id: string; label: string };

type CategorySelectProps = {
  label: string;
  "aria-label": string;
  value: string;
  options: CategoryOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

export default function CategorySelect({
  label,
  "aria-label": ariaLabel,
  value,
  options,
  onChange,
  disabled,
}: CategorySelectProps) {
  const selectedKey = value || options[0]?.id || "";

  return (
    <div className="flex min-w-[9rem] shrink-0 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <span className={`${ui.hint} whitespace-nowrap font-medium`}>{label}</span>
      <Select
        aria-label={ariaLabel}
        variant="secondary"
        selectedKey={selectedKey}
        isDisabled={disabled}
        onSelectionChange={(key) => {
          if (key == null) return;
          onChange(String(key));
        }}
      >
        <Select.Trigger
          className={`${ui.inputControl} ${ui.toolbarControl} w-full min-w-[9rem] !py-0 data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-slate-200 dark:data-[focus-visible=true]:ring-slate-800`}
        >
          <Select.Value className="text-sm" />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox aria-label={`${ariaLabel} 选项`}>
            {options.map((opt) => (
              <ListBoxItem key={opt.id} id={opt.id}>
                {opt.label}
              </ListBoxItem>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}
