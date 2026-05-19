"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SelectedMaterialImage } from "./DraftStreamCreation";
import {
  type CoverTemplateOption,
  type CreativeCoverState,
  emptyCreativeCover,
  fetchCoverTemplates,
  fetchImageCardsCatalog,
  type ImageCardsCatalog,
  generateWorkCover,
  overlayWorkCover,
  renderQuizAnswerCard,
  renderQuizQuestionCard,
  toCoverDisplayUrl,
  uploadCoverBase,
  uploadWorkCover,
} from "./creativeCover";
import CoverSelect, { type CoverSelectOption } from "./CoverSelect";
import { layoutLabel, paletteLabel, styleLabel } from "./imageCardsLabels";

type TabId = "upload" | "generate" | "overlay" | "quiz";

type Props = {
  workId: string;
  bodyText: string;
  defaultTitleMain: string;
  selectedImages: SelectedMaterialImage[];
  cover: CreativeCoverState;
  onCoverChange: (cover: CreativeCoverState) => void;
};

export default function CoverImageSection({
  workId,
  bodyText,
  defaultTitleMain,
  selectedImages,
  cover,
  onCoverChange,
}: Props) {
  const [tab, setTab] = useState<TabId>(
    cover.source === "generated"
      ? "generate"
      : cover.source === "overlay"
        ? "overlay"
        : cover.source === "quiz"
          ? "quiz"
          : "upload",
  );
  const [quizHeader, setQuizHeader] = useState("公基常识");
  const [quizQuestion, setQuizQuestion] = useState("");
  const [quizOptionsText, setQuizOptionsText] = useState(
    "A. 夫妻\nB. 姐妹\nC. 恋人\nD. 兄弟",
  );
  const [quizAnswerHeader, setQuizAnswerHeader] = useState("正确答案");
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizExplanation, setQuizExplanation] = useState("");
  const [quizExtraTitle, setQuizExtraTitle] = useState("古代知识拓展：");
  const [quizExtraText, setQuizExtraText] = useState("");
  const [quizQuestionPath, setQuizQuestionPath] = useState("");
  const [quizAnswerPath, setQuizAnswerPath] = useState("");
  const [baseImagePath, setBaseImagePath] = useState("");
  const [baseMaterialUrl, setBaseMaterialUrl] = useState("");
  const [catalog, setCatalog] = useState<ImageCardsCatalog | null>(null);
  const [templates, setTemplates] = useState<CoverTemplateOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPromptPath, setLastPromptPath] = useState<string | null>(null);
  const [refUrlSet, setRefUrlSet] = useState<Set<string>>(() => new Set(cover.refUrls));
  const fileRef = useRef<HTMLInputElement>(null);
  const baseFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRefUrlSet(new Set(cover.refUrls));
  }, [cover.refUrls]);

  useEffect(() => {
    if (cover.source !== "overlay" || !cover.refUrls[0]) return;
    const ref = cover.refUrls[0];
    if (/^https?:\/\//i.test(ref)) {
      setBaseMaterialUrl(ref);
      setBaseImagePath("");
    } else {
      setBaseImagePath(ref);
      setBaseMaterialUrl("");
    }
  }, [cover.source, cover.refUrls]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void Promise.all([fetchImageCardsCatalog(), fetchCoverTemplates()])
      .then(([cat, list]) => {
        if (cancelled) return;
        setCatalog(cat);
        setTemplates(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载生图配置失败");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const titleMain = cover.titleMain || defaultTitleMain;
  const titleSub = cover.titleSub;

  const toggleRef = useCallback((url: string) => {
    setRefUrlSet((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const refCandidates = useMemo(
    () =>
      selectedImages.map((img) => ({
        key: img.key,
        url: img.displayUrl || img.src,
        thumb: img.displayUrl,
      })),
    [selectedImages],
  );

  const coverPresets = useMemo(() => {
    if (!catalog) return [];
    const ids = new Set(catalog.coverPresetIds);
    return catalog.presets.filter((p) => ids.has(p.id));
  }, [catalog]);

  const presetOptions = useMemo((): CoverSelectOption[] => {
    if (catalogLoading) return [{ value: "", label: "加载中…" }];
    return coverPresets.map((p) => ({
      value: p.id,
      label: `${p.label}（${styleLabel(p.style)} / ${layoutLabel(p.layout)}${
        p.palette ? ` / ${paletteLabel(p.palette)}` : ""
      }）`,
    }));
  }, [catalogLoading, coverPresets]);

  const styleOptions = useMemo((): CoverSelectOption[] => {
    const items = (catalog?.styles ?? []).map((s) => ({
      value: s.id,
      label: styleLabel(s.id, s.label),
    }));
    return [{ value: "", label: "跟随 Preset" }, ...items];
  }, [catalog]);

  const layoutOptions = useMemo((): CoverSelectOption[] => {
    const items = (catalog?.layouts ?? []).map((s) => ({
      value: s.id,
      label: layoutLabel(s.id, s.label),
    }));
    return [{ value: "", label: "跟随 Preset" }, ...items];
  }, [catalog]);

  const paletteOptions = useMemo((): CoverSelectOption[] => {
    const items = (catalog?.palettes ?? []).map((s) => ({
      value: s.id,
      label: paletteLabel(s.id, s.label),
    }));
    return [{ value: "", label: "默认（随风格）" }, ...items];
  }, [catalog]);

  const templateOptions = useMemo((): CoverSelectOption[] => {
    return [
      { value: "", label: "不使用" },
      ...templates.map((t) => ({ value: t.id, label: t.name })),
    ];
  }, [templates]);

  const onUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const path = await uploadWorkCover(workId, file);
        onCoverChange({ ...cover, path, source: "upload", refUrls: [] });
        setTab("upload");
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
      } finally {
        setBusy(false);
      }
    },
    [workId, cover, onCoverChange],
  );

  const onUploadBase = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const path = await uploadCoverBase(workId, file);
        setBaseImagePath(path);
        setBaseMaterialUrl("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "底图上传失败");
      } finally {
        setBusy(false);
      }
    },
    [workId],
  );

  const applyAsCover = useCallback(
    (path: string, titleMain: string, titleSub: string) => {
      onCoverChange({
        ...cover,
        path,
        source: "quiz",
        titleMain,
        titleSub,
        templateId: "",
        templateName: "",
        refUrls: [],
      });
    },
    [cover, onCoverChange],
  );

  const onQuizQuestion = useCallback(async () => {
    if (!quizQuestion.trim()) {
      setError("请填写题目");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = await renderQuizQuestionCard({
        workId,
        header: quizHeader.trim() || "公基常识",
        question: quizQuestion.trim(),
        optionsText: quizOptionsText,
      });
      setQuizQuestionPath(path);
      applyAsCover(path, quizHeader.trim() || "公基常识", quizQuestion.trim());
      setTab("quiz");
    } catch (e) {
      setError(e instanceof Error ? e.message : "题目卡生成失败");
    } finally {
      setBusy(false);
    }
  }, [applyAsCover, quizHeader, quizOptionsText, quizQuestion, workId]);

  const onQuizAnswer = useCallback(async () => {
    if (!quizAnswer.trim()) {
      setError("请填写答案");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = await renderQuizAnswerCard({
        workId,
        header: quizAnswerHeader.trim() || "正确答案",
        answer: quizAnswer.trim(),
        explanation: quizExplanation.trim(),
        extraTitle: quizExtraTitle.trim(),
        extraText: quizExtraText,
      });
      setQuizAnswerPath(path);
      applyAsCover(path, quizAnswerHeader.trim(), quizAnswer.trim());
      setTab("quiz");
    } catch (e) {
      setError(e instanceof Error ? e.message : "答案卡生成失败");
    } finally {
      setBusy(false);
    }
  }, [
    applyAsCover,
    quizAnswer,
    quizAnswerHeader,
    quizExplanation,
    quizExtraText,
    quizExtraTitle,
    workId,
  ]);

  const onOverlay = useCallback(async () => {
    const main = titleMain || defaultTitleMain;
    if (!main.trim()) {
      setError("请填写主标题");
      return;
    }
    if (!baseImagePath && !baseMaterialUrl) {
      setError("请上传底图或从已选配图中选择一张");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = await overlayWorkCover({
        workId,
        titleMain: main.trim(),
        titleSub: titleSub.trim(),
        baseImagePath: baseImagePath || undefined,
        baseImageUrl: baseMaterialUrl || undefined,
      });
      const baseRef = baseMaterialUrl || baseImagePath;
      onCoverChange({
        ...cover,
        path,
        source: "overlay",
        refUrls: baseRef ? [baseRef] : [],
        titleMain: main.trim(),
        titleSub: titleSub.trim(),
        templateId: "",
        templateName: "",
      });
      setTab("overlay");
    } catch (e) {
      setError(e instanceof Error ? e.message : "叠字失败");
    } finally {
      setBusy(false);
    }
  }, [
    baseImagePath,
    baseMaterialUrl,
    cover,
    defaultTitleMain,
    onCoverChange,
    titleMain,
    titleSub,
    workId,
  ]);

  const onGenerate = useCallback(async () => {
    if (!cover.preset && !cover.style) {
      setError("请选择风格 Preset 或高级 Style");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const refs = Array.from(refUrlSet);
      const { path, promptPath } = await generateWorkCover({
        workId,
        templateStyleId: cover.templateId.trim() || undefined,
        preset: cover.preset || undefined,
        style: cover.style || undefined,
        layout: cover.layout || undefined,
        palette: cover.palette || undefined,
        topic: titleMain || defaultTitleMain || "小红书封面",
        content: bodyText,
        titleMain: titleMain || defaultTitleMain || "小红书封面",
        titleSub,
        referenceImageUrls: refs,
      });
      const tpl = templates.find((t) => t.id === cover.templateId);
      onCoverChange({
        ...cover,
        path,
        source: "generated",
        templateName: tpl?.name ?? cover.templateName,
        refUrls: refs,
        titleMain: titleMain || defaultTitleMain,
        titleSub,
      });
      setLastPromptPath(promptPath ?? null);
      setTab("generate");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }, [
    bodyText,
    cover,
    defaultTitleMain,
    onCoverChange,
    refUrlSet,
    templates,
    titleMain,
    titleSub,
    workId,
  ]);

  const previewUrl = toCoverDisplayUrl(cover.path);

  return (
    <section className="mt-3 rounded-lg border border-slate-200/90 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
          图片创作 · 封面图 <span className="text-rose-600 dark:text-rose-400">*</span>
        </p>
        {cover.path ? (
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            onClick={() =>
              onCoverChange({
                ...emptyCreativeCover(),
                titleMain: cover.titleMain,
                titleSub: cover.titleSub,
                preset: cover.preset || "clean-quote",
              })
            }
          >
            移除封面
          </button>
        ) : null}
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-600">
        {(
          [
            ["upload", "本地上传"],
            ["quiz", "每日一题"],
            ["overlay", "底图叠字"],
            ["generate", "在线创作"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
              tab === id
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {previewUrl ? (
        <div className="mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="封面预览"
            className="max-h-56 w-auto max-w-full rounded-lg border border-slate-200 object-contain dark:border-slate-700"
          />
        </div>
      ) : null}

      {tab === "upload" ? (
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:border-slate-400 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            {busy ? "上传中…" : "选择图片上传（不限格式与尺寸）"}
          </button>
        </div>
      ) : tab === "overlay" ? (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            保留实拍底图，仅在顶部叠加账号/副标题（黄字）、中部主标题（白字黑描边），不重绘整张图。
          </p>
          <input
            ref={baseFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onUploadBase(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => baseFileRef.current?.click()}
            className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:border-slate-400 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            {busy ? "处理中…" : baseImagePath ? "重新上传底图" : "上传底图"}
          </button>
          {baseImagePath ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">已上传底图，将用于叠字</p>
          ) : null}
          {refCandidates.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                或从已选配图选一张作底图（单选）
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {refCandidates.map((item) => {
                  const on = baseMaterialUrl === item.url;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBaseMaterialUrl(item.url);
                        setBaseImagePath("");
                      }}
                      className={`relative overflow-hidden rounded-md border-2 outline-none ${
                        on
                          ? "border-emerald-500 ring-2 ring-emerald-300/50"
                          : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.thumb} alt="" className="h-16 w-16 object-cover" />
                      {on ? (
                        <span className="absolute right-0.5 top-0.5 rounded bg-emerald-600 px-1 text-[9px] text-white">
                          底图
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">暂无已选配图，请上传底图。</p>
          )}
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            主标题（居中白字描边）
            <input
              value={titleMain}
              onChange={(e) => onCoverChange({ ...cover, titleMain: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            顶部账号/副标题（黄字，可填 @昵称）
            <input
              value={titleSub}
              onChange={(e) => onCoverChange({ ...cover, titleSub: e.target.value })}
              placeholder="@你的账号"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <button
            type="button"
            disabled={busy || (!baseImagePath && !baseMaterialUrl)}
            onClick={() => void onOverlay()}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "叠字中…" : "生成叠字封面"}
          </button>
        </div>
      ) : tab === "quiz" ? (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            黄底答题卡 / 答案卡，程序排版（非 AI 生图），版式对齐公考「每日一题」。
          </p>
          <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300">题目卡</p>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            顶栏标题
            <input
              value={quizHeader}
              onChange={(e) => setQuizHeader(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            题目
            <textarea
              value={quizQuestion}
              onChange={(e) => setQuizQuestion(e.target.value)}
              rows={3}
              placeholder={'1. 「鸳鸯」在古代指的是（  ）'}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            选项（每行一项）
            <textarea
              value={quizOptionsText}
              onChange={(e) => setQuizOptionsText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onQuizQuestion()}
            className="w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? "生成中…" : "生成题目卡"}
          </button>
          {quizQuestionPath ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={toCoverDisplayUrl(quizQuestionPath)}
                alt="题目卡"
                className="max-h-40 rounded border border-slate-200 object-contain"
              />
              <button
                type="button"
                className="text-[11px] text-amber-700 underline dark:text-amber-300"
                onClick={() => applyAsCover(quizQuestionPath, quizHeader, quizQuestion)}
              >
                设为作品封面
              </button>
            </div>
          ) : null}
          <hr className="border-slate-200 dark:border-slate-700" />
          <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300">答案卡</p>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            顶栏标题
            <input
              value={quizAnswerHeader}
              onChange={(e) => setQuizAnswerHeader(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            答案
            <input
              value={quizAnswer}
              onChange={(e) => setQuizAnswer(e.target.value)}
              placeholder="D. 兄弟"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            解析
            <textarea
              value={quizExplanation}
              onChange={(e) => setQuizExplanation(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            拓展标题
            <input
              value={quizExtraTitle}
              onChange={(e) => setQuizExtraTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            拓展词条（每行一条）
            <textarea
              value={quizExtraText}
              onChange={(e) => setQuizExtraText(e.target.value)}
              rows={4}
              placeholder={"桃李：学生\n伉俪：夫妻"}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onQuizAnswer()}
            className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? "生成中…" : "生成答案卡"}
          </button>
          {quizAnswerPath ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={toCoverDisplayUrl(quizAnswerPath)}
                alt="答案卡"
                className="max-h-40 rounded border border-slate-200 object-contain"
              />
              <button
                type="button"
                className="text-[11px] text-amber-700 underline dark:text-amber-300"
                onClick={() => applyAsCover(quizAnswerPath, quizAnswerHeader, quizAnswer)}
              >
                设为作品封面
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            按{" "}
            <a
              href="https://www.skills.sh/jimliu/baoyu-skills/baoyu-image-cards"
              target="_blank"
              rel="noopener noreferrer"
              className="text-rose-700 underline dark:text-rose-300"
            >
              baoyu-image-cards
            </a>{" "}
            组装 prompt → <code className="text-[10px]">image-cards/…/prompts/01-cover-*.md</code> → DashScope 出图
          </p>
          <div className="block text-[11px] text-slate-600 dark:text-slate-400">
            <span className="mb-1 block">风格预设 Preset</span>
            <CoverSelect
              value={cover.preset}
              disabled={catalogLoading || busy}
              options={presetOptions}
              placeholder="请选择 Preset"
              onChange={(preset) =>
                onCoverChange({
                  ...cover,
                  preset,
                  style: "",
                  layout: "",
                  palette: "",
                })
              }
            />
          </div>
          <details className="relative z-20 rounded-lg border border-slate-200/80 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/95">
            <summary className="cursor-pointer text-[11px] font-medium text-slate-600 dark:text-slate-400">
              高级：风格 / 版式 / 配色
            </summary>
            <div className="mt-2 flex flex-col gap-3 pb-1">
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                <span className="mb-1 block">风格 Style</span>
                <CoverSelect
                  value={cover.style}
                  disabled={catalogLoading || busy}
                  options={styleOptions}
                  onChange={(style) => onCoverChange({ ...cover, style, preset: "" })}
                />
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                <span className="mb-1 block">版式 Layout</span>
                <CoverSelect
                  value={cover.layout}
                  disabled={catalogLoading || busy}
                  options={layoutOptions}
                  onChange={(layout) => onCoverChange({ ...cover, layout, preset: "" })}
                />
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                <span className="mb-1 block">配色 Palette</span>
                <CoverSelect
                  value={cover.palette}
                  disabled={catalogLoading || busy}
                  options={paletteOptions}
                  onChange={(palette) => onCoverChange({ ...cover, palette, preset: "" })}
                />
              </div>
            </div>
          </details>
          <div className="block text-[11px] text-slate-600 dark:text-slate-400">
            <span className="mb-1 block">补充模版（提示词管理 · 封面模版，可选）</span>
            <CoverSelect
              value={cover.templateId}
              disabled={catalogLoading || busy}
              options={templateOptions}
              placeholder="不使用"
              onChange={(templateId) => {
                const tpl = templates.find((t) => t.id === templateId);
                onCoverChange({
                  ...cover,
                  templateId,
                  templateName: tpl?.name ?? "",
                });
              }}
            />
          </div>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            主标题
            <input
              value={titleMain}
              onChange={(e) => onCoverChange({ ...cover, titleMain: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400">
            副标题
            <input
              value={titleSub}
              onChange={(e) => onCoverChange({ ...cover, titleSub: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          {refCandidates.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                参考已选配图（可多选，可不选）
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {refCandidates.map((item) => {
                  const on = refUrlSet.has(item.url);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleRef(item.url)}
                      className={`relative overflow-hidden rounded-md border-2 outline-none ${
                        on
                          ? "border-rose-500 ring-2 ring-rose-300/50"
                          : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.thumb} alt="" className="h-16 w-16 object-cover" />
                      {on ? (
                        <span className="absolute right-0.5 top-0.5 rounded bg-rose-600 px-1 text-[9px] text-white">
                          参考
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              暂无已选配图；可直接用 Preset 与标题生成。
            </p>
          )}
          <button
            type="button"
            disabled={busy || catalogLoading || (!cover.preset && !cover.style)}
            onClick={() => void onGenerate()}
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? "生成中…" : "按 baoyu 规范生成封面"}
          </button>
          {lastPromptPath ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Prompt 文件：{lastPromptPath}</p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {!cover.path ? (
        <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
          保存作品前须完成封面（本地上传、每日一题、底图叠字或在线创作）。
        </p>
      ) : null}
    </section>
  );
}
