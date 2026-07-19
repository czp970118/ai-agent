"use client";

import { adminFormStyles as ui } from "../components/formStyles";
import CategorySelect from "./CategorySelect";
import { REAL_EXAM_KINDS, realExamKindNeedsRegion } from "./realExam";

type RealExamFieldsProps = {
  examKind: string;
  examYear: string;
  examRegion: string;
  disabled?: boolean;
  onExamKindChange: (kind: string) => void;
  onExamYearChange: (year: string) => void;
  onExamRegionChange: (region: string) => void;
  /** 导入工具栏横排；弹窗内竖排更稳 */
  layout?: "toolbar" | "form";
};

const fieldLabel = `${ui.hint} block leading-4`;
const fieldInput = `${ui.input} w-full`;

export default function RealExamFields({
  examKind,
  examYear,
  examRegion,
  disabled,
  onExamKindChange,
  onExamYearChange,
  onExamRegionChange,
  layout = "toolbar",
}: RealExamFieldsProps) {
  const handleKindChange = (v: string) => {
    const next = v === "__none__" ? "" : v;
    onExamKindChange(next);
    if (next === "国考") onExamRegionChange("");
  };

  const kindSelect = (
    <CategorySelect
      label="考试类型"
      aria-label="考试类型"
      value={examKind || "__none__"}
      onChange={handleKindChange}
      disabled={disabled}
      options={[
        { id: "__none__", label: "请选择" },
        ...REAL_EXAM_KINDS.map((k) => ({ id: k, label: k })),
      ]}
    />
  );

  const yearField = (
    <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
      <span className={fieldLabel}>年份</span>
      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        placeholder="如 2019"
        value={examYear}
        disabled={disabled}
        onChange={(e) => onExamYearChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className={fieldInput}
      />
    </label>
  );

  const regionField = (
    <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
      <span className={fieldLabel}>省份</span>
      <input
        type="text"
        placeholder={examKind === "国考" ? "可留空，默认全国" : "如：江苏、广东"}
        value={examRegion}
        disabled={disabled || !realExamKindNeedsRegion(examKind)}
        onChange={(e) => onExamRegionChange(e.target.value)}
        className={fieldInput}
      />
    </label>
  );

  if (layout === "form") {
    return (
      <div className="space-y-3">
        {kindSelect}
        <div className="grid grid-cols-2 gap-3">
          {yearField}
          {regionField}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {kindSelect}
      <label className="grid w-[5.5rem] shrink-0 gap-1 text-sm text-slate-700 dark:text-slate-200">
        <span className={`${ui.hint} ${ui.toolbarLabel}`}>年份</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="如 2019"
          value={examYear}
          disabled={disabled}
          onChange={(e) => onExamYearChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className={`${ui.inputControl} ${ui.toolbarControl} w-full tabular-nums outline-none focus:ring-2 focus:ring-slate-200 dark:focus:ring-slate-800`}
        />
      </label>
      <label className="grid min-w-[10rem] shrink-0 gap-1 text-sm text-slate-700 dark:text-slate-200">
        <span className={`${ui.hint} ${ui.toolbarLabel}`}>省份</span>
        <input
          type="text"
          placeholder={examKind === "国考" ? "可留空，默认全国" : "如：江苏、广东"}
          value={examRegion}
          disabled={disabled || !realExamKindNeedsRegion(examKind)}
          onChange={(e) => onExamRegionChange(e.target.value)}
          className={`${ui.inputControl} ${ui.toolbarControl} w-full min-w-[9rem] outline-none focus:ring-2 focus:ring-slate-200 dark:focus:ring-slate-800`}
        />
      </label>
    </div>
  );
}
