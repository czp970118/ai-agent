"use client";

import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";
import type { MessageReference } from "@/app/assistant/utils/types";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import CoverImageSection from "./CoverImageSection";
import type { CreativeCoverState } from "./creativeCover";
import type { MaterialCacheNote } from "./materialCacheNotes";
import {
  buildMaterialGalleryImages,
  extractMaterialImageUrls,
  materialImageKey,
  resolveMaterialImageDisplayUrl,
} from "./materialCacheNotes";
import { streamXhsPostGeneration } from "./streamXhsMcp";

export type SelectedMaterialImage = {
  key: string;
  src: string;
  displayUrl: string;
  noteId: string;
  noteTitle: string;
  noteUrl: string;
};

export type CreativeDraftStatus = "draft" | "ready";

const DOMAIN_OPTIONS = ["旅游", "考公", "穿搭", "吃喝", "职场", "健身", "情感"] as const;

const STATUS_LABEL: Record<CreativeDraftStatus, string> = {
  draft: "草稿",
  ready: "定稿",
};

type PromptStyle = {
  id: string;
  name: string;
  body?: string;
  body_preview?: string;
  is_default?: boolean;
};

function guessDomain(vertical?: string): string {
  if (!vertical?.trim()) return "旅游";
  const t = vertical;
  if (t.includes("考公") || t.includes("公考") || t.includes("时政")) return "考公";
  if (t.includes("吃喝") || t.includes("美食") || t.includes("探店")) return "吃喝";
  if (t.includes("穿搭")) return "穿搭";
  if (t.includes("职场")) return "职场";
  if (t.includes("健身")) return "健身";
  if (t.includes("情感")) return "情感";
  return "旅游";
}

type PickerOption = { value: string; label: string };

/** 避免原生 select 在 macOS 上弹出系统深色大菜单，与后台浅色样式冲突 */
function LocalPicker({
  label,
  value,
  options,
  onChange,
  disabled,
  emptyPlaceholder,
}: {
  label: ReactNode;
  value: string;
  options: PickerOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  emptyPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const displayLabel =
    options.find((o) => o.value === value)?.label ??
    (options.length ? value : (emptyPlaceholder ?? "—"));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    setOpen(false);
  }, [value]);

  const inactive = !!disabled || options.length === 0;

  return (
    <div className="block text-xs" ref={rootRef}>
      <div className="font-medium text-slate-600 dark:text-slate-400">{label}</div>
      <div className="relative mt-1">
        <button
          type="button"
          disabled={inactive}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => {
            if (!inactive) setOpen((o) => !o);
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm outline-none ring-rose-200/40 transition hover:border-slate-300 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:ring-rose-500/30 dark:hover:border-slate-500"
        >
          <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
          <span className="shrink-0 text-slate-400" aria-hidden>
            ▾
          </span>
        </button>
        {open && !inactive ? (
          <ul
            role="listbox"
            className="absolute z-[100] mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-900 shadow-lg ring-1 ring-black/5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:ring-white/10"
          >
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={`block w-full truncate px-3 py-2 text-left transition hover:bg-rose-50 dark:hover:bg-slate-700/80 ${
                      selected
                        ? "bg-rose-50/90 font-medium text-rose-900 dark:bg-slate-700 dark:text-rose-100"
                        : ""
                    }`}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export type StreamAdoptMeta = {
  promptLine: string;
  promptStyleName: string;
  domain: string;
};

export type StreamSuccessPayload = {
  content: string;
  references: MessageReference[];
  searchTerms: string[];
  /** 本次生成实际使用的垂类（避免 setState 未完成时拉取用到旧值） */
  domain: string;
  coverPath?: string;
};

export type MaterialCacheState = {
  loading: boolean;
  hint: string | null;
  notes: MaterialCacheNote[];
  /** 当前批次（从 1 起） */
  page: number;
  total: number;
  hasMore: boolean;
};

function MaterialImageLightbox({
  images,
  index,
  selectedKeySet,
  onClose,
  onChangeIndex,
  onToggleSelect,
}: {
  images: SelectedMaterialImage[];
  index: number;
  selectedKeySet: Set<string>;
  onClose: () => void;
  onChangeIndex: (nextIndex: number) => void;
  onToggleSelect: (image: SelectedMaterialImage) => void;
}) {
  const image = images[index];
  const canPrev = index > 0;
  const canNext = index < images.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && canPrev) {
        e.preventDefault();
        onChangeIndex(index - 1);
      }
      if (e.key === "ArrowRight" && canNext) {
        e.preventDefault();
        onChangeIndex(index + 1);
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, canPrev, canNext, onClose, onChangeIndex]);

  if (!image) return null;

  const selected = selectedKeySet.has(image.key);
  const showNav = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="查看配图"
      onClick={onClose}
    >
      <div className="flex max-h-[92vh] w-full max-w-[min(96vw,1040px)] items-center justify-center gap-2 sm:gap-3">
        {showNav ? (
          <button
            type="button"
            disabled={!canPrev}
            onClick={(e) => {
              e.stopPropagation();
              if (canPrev) onChangeIndex(index - 1);
            }}
            className="shrink-0 rounded-full border border-white/25 bg-black/40 px-3 py-3 text-lg text-white transition hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="上一张"
          >
            ‹
          </button>
        ) : (
          <span className="hidden w-11 sm:block" aria-hidden />
        )}

        <div
          className="relative flex min-w-0 max-w-full flex-1 flex-col items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {showNav ? (
            <p className="mb-2 text-xs text-white/70">
              {index + 1} / {images.length}
              <span className="mx-2 text-white/40">·</span>
              键盘 ← → 切换
            </p>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={image.key}
            src={image.displayUrl}
            alt=""
            className="max-h-[72vh] max-w-full rounded-lg object-contain shadow-2xl sm:max-h-[78vh]"
          />
          <p className="mt-2 max-w-full truncate px-2 text-center text-xs text-white/80">
            {image.noteTitle}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => onToggleSelect(image)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                selected ? "bg-white text-slate-900" : "bg-rose-600 text-white hover:bg-rose-500"
              }`}
            >
              {selected ? "取消选用" : "选用此图"}
            </button>
            <a
              href={image.noteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              打开原帖
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              关闭
            </button>
          </div>
        </div>

        {showNav ? (
          <button
            type="button"
            disabled={!canNext}
            onClick={(e) => {
              e.stopPropagation();
              if (canNext) onChangeIndex(index + 1);
            }}
            className="shrink-0 rounded-full border border-white/25 bg-black/40 px-3 py-3 text-lg text-white transition hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="下一张"
          >
            ›
          </button>
        ) : (
          <span className="hidden w-11 sm:block" aria-hidden />
        )}
      </div>
    </div>
  );
}

function MaterialImageThumb({
  src,
  noteId,
  noteTitle,
  noteUrl,
  index,
  selected,
  onPreview,
  onToggleSelect,
}: {
  src: string;
  noteId: string;
  noteTitle: string;
  noteUrl: string;
  index: number;
  selected: boolean;
  onPreview: (image: SelectedMaterialImage) => void;
  onToggleSelect: (image: SelectedMaterialImage) => void;
}) {
  const [broken, setBroken] = useState(false);
  const displayUrl = resolveMaterialImageDisplayUrl(src);
  if (!displayUrl) return null;

  const image: SelectedMaterialImage = {
    key: materialImageKey(noteId, src, index),
    src,
    displayUrl,
    noteId,
    noteTitle,
    noteUrl,
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => onPreview(image)}
        className={`block overflow-hidden rounded-md border bg-slate-100 shadow-sm outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-rose-400 dark:bg-slate-800 ${
          selected
            ? "border-rose-500 ring-2 ring-rose-500/60"
            : "border-slate-200 dark:border-slate-600"
        }`}
        title="点击放大查看"
      >
        {broken ? (
          <span className="flex h-[72px] w-[72px] items-center justify-center bg-slate-200 text-[10px] text-slate-500 dark:bg-slate-700 dark:text-slate-400">
            加载失败
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={displayUrl}
            alt=""
            loading="lazy"
            className="h-[72px] w-[72px] object-cover"
            onError={() => setBroken(true)}
          />
        )}
      </button>
      <button
        type="button"
        aria-label={selected ? "取消选用" : "选用"}
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(image);
        }}
        className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold shadow ${
          selected
            ? "border-rose-600 bg-rose-600 text-white"
            : "border-white/90 bg-black/50 text-white hover:bg-black/70"
        }`}
      >
        {selected ? "✓" : "+"}
      </button>
    </div>
  );
}

type Props = {
  /** 传给 MCP workflow 的追踪 id（兼容字段名 creative_project_id） */
  workId: string;
  initialDomain?: string;
  domain?: string;
  onDomainChange?: (domain: string) => void;
  onAdopt: (content: string, refs: MessageReference[], meta: StreamAdoptMeta) => void;
  /** 插在标题与表单之间（如作品名称） */
  topSlot?: ReactNode;
  /** 流式输出与「采用」之间（如同步列表说明） */
  notesSlot?: ReactNode;
  /** 默认 true；新建页单块布局可关闭底部「素材区」 */
  showMaterialPanel?: boolean;
  /** 生成后缓存帖子（配图）；不传则不展示「缓存帖子」分块 */
  materialCache?: MaterialCacheState;
  /** 换一批：在相同筛选条件下拉取下一页缓存帖子 */
  onLoadNextMaterialBatch?: () => void;
  /** 正文编辑（生成结束后在此修改；流式中仍显示流式内容） */
  body?: string;
  onBodyChange?: (value: string) => void;
  /** 草稿 / 定稿；定稿后正文为审阅（只读） */
  draftStatus?: CreativeDraftStatus;
  onDraftStatusChange?: (status: CreativeDraftStatus) => void;
  footerSlot?: ReactNode;
  /** 流式成功结束后（含正文与 references） */
  onStreamSuccess?: (payload: StreamSuccessPayload) => void;
  /** 用户点击「生成」时（用于合并页在重新生成时收起已采用态） */
  onStreamStart?: () => void;
  /** 封面图（必填，由父组件在保存时校验） */
  cover: CreativeCoverState;
  onCoverChange: (cover: CreativeCoverState) => void;
  /** 用于封面默认主标题 */
  workTitle?: string;
  /** @deprecated 使用 footerSlot */
  footerAfterAdopt?: ReactNode;
};

export default function DraftStreamCreation({
  workId,
  initialDomain,
  domain: domainControlled,
  onDomainChange,
  onAdopt,
  topSlot,
  notesSlot,
  showMaterialPanel = true,
  materialCache,
  onLoadNextMaterialBatch,
  body: bodyProp,
  onBodyChange,
  draftStatus = "draft",
  onDraftStatusChange,
  footerSlot,
  footerAfterAdopt,
  onStreamSuccess,
  onStreamStart,
  cover,
  onCoverChange,
  workTitle = "",
}: Props) {
  const [oneLine, setOneLine] = useState("");
  const [streamText, setStreamText] = useState("");
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [materialPanelOpen, setMaterialPanelOpen] = useState(true);
  const [selectedImages, setSelectedImages] = useState<SelectedMaterialImage[]>([]);
  const [previewImage, setPreviewImage] = useState<SelectedMaterialImage | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedKeySet = useMemo(
    () => new Set(selectedImages.map((img) => img.key)),
    [selectedImages],
  );

  const toggleSelectedImage = useCallback((image: SelectedMaterialImage) => {
    setSelectedImages((prev) => {
      const exists = prev.some((item) => item.key === image.key);
      if (exists) return prev.filter((item) => item.key !== image.key);
      return [...prev, image];
    });
  }, []);

  const removeSelectedImage = useCallback((key: string) => {
    setSelectedImages((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const galleryImages = useMemo(
    () => buildMaterialGalleryImages(materialCache?.notes ?? []),
    [materialCache?.notes],
  );

  const lightboxImages = useMemo(() => {
    if (!previewImage) return galleryImages;
    if (galleryImages.some((img) => img.key === previewImage.key)) return galleryImages;
    return [previewImage, ...galleryImages];
  }, [galleryImages, previewImage]);

  const lightboxIndex = useMemo(() => {
    if (!previewImage || lightboxImages.length === 0) return 0;
    const idx = lightboxImages.findIndex((img) => img.key === previewImage.key);
    return idx >= 0 ? idx : 0;
  }, [previewImage, lightboxImages]);

  const isDomainControlled =
    typeof domainControlled === "string" && typeof onDomainChange === "function";

  const [internalDomain, setInternalDomain] = useState(() =>
    guessDomain(initialDomain ?? domainControlled),
  );

  useEffect(() => {
    if (isDomainControlled) return;
    setInternalDomain(guessDomain(initialDomain));
  }, [initialDomain, isDomainControlled]);

  const selectedDomain = isDomainControlled ? domainControlled : internalDomain;
  const setSelectedDomain = isDomainControlled ? onDomainChange! : setInternalDomain;

  const [currentDomainStyles, setCurrentDomainStyles] = useState<PromptStyle[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadDomainStyles() {
      if (!selectedDomain.trim()) {
        setCurrentDomainStyles([]);
        setSelectedPromptId("");
        setLoadingPrompts(false);
        return;
      }
      setLoadingPrompts(true);
      try {
        const res = await fetch(
          `${getMcpBaseUrl()}/chat/prompt-library?agent=${encodeURIComponent(
            "xiaohongshu",
          )}&domain=${encodeURIComponent(selectedDomain)}&include_body=true`,
        );
        if (!res.ok) {
          if (!cancelled) setCurrentDomainStyles([]);
          return;
        }
        const payload = (await res.json()) as {
          categories?: Array<{ styles?: PromptStyle[] }>;
        };
        const categories = Array.isArray(payload.categories) ? payload.categories : [];
        const styles = categories[0]?.styles ?? [];
        if (cancelled) return;
        setCurrentDomainStyles(styles);
      } catch {
        if (!cancelled) setCurrentDomainStyles([]);
      } finally {
        if (!cancelled) setLoadingPrompts(false);
      }
    }
    void loadDomainStyles();
    return () => {
      cancelled = true;
    };
  }, [selectedDomain]);

  useEffect(() => {
    if (!currentDomainStyles.length) {
      setSelectedPromptId("");
      return;
    }
    if (currentDomainStyles.some((item) => item.id === selectedPromptId)) return;
    const def =
      currentDomainStyles.find((item) => !!item.is_default) ?? currentDomainStyles[0] ?? null;
    setSelectedPromptId(def?.id ?? "");
  }, [currentDomainStyles, selectedPromptId]);

  const selectedPrompt = useMemo(
    () => currentDomainStyles.find((item) => item.id === selectedPromptId) ?? null,
    [currentDomainStyles, selectedPromptId],
  );

  const isBodyControlled = typeof bodyProp === "string" && typeof onBodyChange === "function";
  const resolvedFooter = footerSlot ?? footerAfterAdopt;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const runStream = async (e: FormEvent) => {
    e.preventDefault();
    const text = oneLine.trim();
    if (!text || loading) return;

    onStreamStart?.();

    setError(null);
    setStreamText("正在搜索并总结文案…");
    setSearchTerms([]);
    setSelectedImages([]);
    setPreviewImage(null);

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const promptCandidates = currentDomainStyles.map((item) => ({
      id: item.id,
      name: item.name,
      is_default: !!item.is_default,
      body: String(item.body ?? item.body_preview ?? ""),
    }));

    const workflow: Record<string, unknown> = {
      agent: "xiaohongshu",
      mode: "default",
      generate_cover_image: false,
      cover: { style: "off", title_main: text.slice(0, 24) || "小红书", title_sub: "" },
      prompt: text,
      prompt_domain: selectedDomain || undefined,
      prompt_domains: selectedDomain ? [selectedDomain] : [],
      prompt_style_id: selectedPromptId || undefined,
      prompt_style_name: selectedPrompt?.name || undefined,
      prompt_candidates: promptCandidates,
      creative_project_id: workId,
    };

    try {
      const result = await streamXhsPostGeneration({
        userPrompt: text,
        workflow,
        signal: controller.signal,
        onDelta: (full) => {
          setStreamText(full);
        },
      });
      setStreamText(result.content);
      setSearchTerms(result.searchMeta?.queryTerms ?? []);
      const promptLine = oneLine.trim();
      const meta: StreamAdoptMeta = {
        promptLine,
        promptStyleName: selectedPrompt?.name?.trim() ?? "",
        domain: selectedDomain,
      };
      onAdopt(result.content, result.references, meta);
      onStreamSuccess?.({
        content: result.content,
        references: result.references,
        searchTerms: result.searchMeta?.queryTerms ?? [],
        domain: selectedDomain,
        coverPath: result.coverImagePath,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStreamText((prev) => (prev.includes("已停止") ? prev : `${prev.trimEnd()}\n\n已停止。`));
      } else {
        const msg = err instanceof Error ? err.message : "请求失败";
        setError(msg);
        setStreamText("");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const textareaValue = loading ? streamText : isBodyControlled ? bodyProp! : streamText;
  const textareaReadOnly = draftStatus === "ready";
  const showDraftToggle = typeof onDraftStatusChange === "function";

  return (
    <div className="flex w-full max-w-none flex-col overflow-hidden rounded-xl border border-rose-200/80 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20">
      <div className="flex min-h-0 w-full flex-1 flex-col lg:flex-row lg:items-stretch">
        <div className="w-full min-w-0 border-b border-rose-200/60 p-4 dark:border-rose-900/40 lg:flex-1 lg:basis-0 lg:border-b-0 lg:border-r lg:p-5">
          {topSlot ? <div className="mb-4">{topSlot}</div> : null}
          <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-100">
            一句话创作（流式）
          </h3>
          <p className="mt-1 text-xs text-rose-800/80 dark:text-rose-200/80">
            {showMaterialPanel ? (
              <>
                与 Ai-Agent 小红书同源
                MCP；正文在文本框编辑，可随时调整垂类与模板后重新生成；宽屏下素材区与文案区各占约一半宽度，以素材创作为主。
              </>
            ) : (
              <>
                与 Ai-Agent 小红书同源
                MCP；生成结束后会同步缓存帖子并在下方素材区展示配图；正文在文本框编辑，可随时重新生成。
              </>
            )}
          </p>
          <form onSubmit={runStream} className="mt-3 flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <LocalPicker
                label="写作垂类"
                value={selectedDomain}
                options={DOMAIN_OPTIONS.map((d) => ({ value: d, label: d }))}
                onChange={setSelectedDomain}
                disabled={loading}
              />
              <LocalPicker
                label={
                  <span>
                    提示词模板
                    {loadingPrompts ? <span className="text-slate-400">（加载中）</span> : null}
                  </span>
                }
                value={selectedPromptId}
                options={currentDomainStyles.map((s) => ({ value: s.id, label: s.name }))}
                onChange={setSelectedPromptId}
                disabled={loading || !currentDomainStyles.length}
                emptyPlaceholder="当前垂类暂无模板"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={oneLine}
                onChange={(e) => setOneLine(e.target.value)}
                placeholder="用一句话描述要写的小红书主题…"
                disabled={loading}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-rose-200/30 focus-visible:ring-2 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:ring-rose-500/20"
              />
              <button
                type="submit"
                disabled={loading || !oneLine.trim()}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                生成
              </button>
              {loading ? (
                <button
                  type="button"
                  onClick={stop}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
                >
                  停止
                </button>
              ) : null}
            </div>
          </form>
          {error ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-6">
            {showDraftToggle ? (
              <div className="mb-2 flex flex-wrap items-center justify-start gap-2">
                <div
                  className="flex rounded-lg border border-slate-200/90 bg-white/95 p-0.5 shadow-sm dark:border-slate-600 dark:bg-slate-900/95"
                  role="radiogroup"
                  aria-label="草稿或定稿"
                >
                  {(["draft", "ready"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={draftStatus === s}
                      onClick={() => onDraftStatusChange!(s)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        draftStatus === s
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                      }`}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                {draftStatus === "ready" ? (
                  <span className="rounded-md border border-amber-200/80 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-100">
                    审阅
                  </span>
                ) : null}
              </div>
            ) : null}
            <textarea
              value={textareaValue}
              readOnly={textareaReadOnly || loading}
              onChange={(e) => {
                if (textareaReadOnly || loading) return;
                if (isBodyControlled) onBodyChange!(e.target.value);
                else setStreamText(e.target.value);
              }}
              rows={12}
              placeholder="生成结果将显示在这里；也可直接撰写或粘贴文案。"
              className={`min-h-[280px] w-full resize-y whitespace-pre-wrap rounded-lg border border-slate-200 bg-white/90 px-3 py-3 font-sans text-sm leading-relaxed text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-rose-300/80 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:focus-visible:ring-rose-500/40 ${
                textareaReadOnly
                  ? "cursor-default bg-slate-50/90 text-slate-700 dark:bg-slate-950/80 dark:text-slate-300"
                  : ""
              }`}
              aria-label="正文"
            />
          </div>
          {searchTerms.length > 0 ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              检索词：{searchTerms.join("、")}
            </p>
          ) : null}
          {selectedImages.length > 0 ? (
            <section className="mt-3 rounded-lg border border-rose-200/80 bg-white/70 p-3 dark:border-rose-900/50 dark:bg-slate-900/40">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  已选配图（{selectedImages.length}）
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedImages([])}
                  className="text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  清空
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedImages.map((img) => (
                  <div key={img.key} className="group relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewImage(img)}
                      className="block overflow-hidden rounded-md border border-rose-200 shadow-sm outline-none ring-rose-300/50 focus-visible:ring-2 dark:border-rose-900/60"
                      title="点击放大"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.displayUrl}
                        alt=""
                        className="h-20 w-20 object-cover sm:h-24 sm:w-24"
                      />
                    </button>
                    <button
                      type="button"
                      aria-label="移除"
                      onClick={() => removeSelectedImage(img.key)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-900 text-[10px] text-white opacity-90 hover:bg-slate-700"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <CoverImageSection
            workId={workId}
            bodyText={textareaValue}
            defaultTitleMain={
              workTitle.trim() ||
              oneLine.trim() ||
              textareaValue.split("\n")[0]?.trim().slice(0, 24) ||
              "小红书封面"
            }
            selectedImages={selectedImages}
            cover={cover}
            onCoverChange={onCoverChange}
          />
          {notesSlot ? <div className="mt-3">{notesSlot}</div> : null}
        </div>

        {showMaterialPanel && !materialPanelOpen ? (
          <button
            type="button"
            onClick={() => setMaterialPanelOpen(true)}
            className="flex w-full items-center justify-center gap-1 border-t border-rose-200/60 bg-white/50 px-3 py-2.5 text-xs font-medium text-rose-800 hover:bg-white/80 dark:border-rose-900/40 dark:bg-slate-950/40 dark:text-rose-200 dark:hover:bg-slate-900/60 lg:w-10 lg:flex-col lg:border-t-0 lg:border-l lg:px-2 lg:py-6"
            aria-expanded={false}
          >
            <span className="lg:[writing-mode:vertical-rl]">展开素材区</span>
            {selectedImages.length > 0 ? (
              <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] text-white lg:mt-1">
                {selectedImages.length}
              </span>
            ) : null}
          </button>
        ) : null}

        {showMaterialPanel && materialPanelOpen ? (
          <aside className="flex w-full min-w-0 flex-col border-t border-rose-200/50 bg-white/45 p-4 dark:border-rose-900/35 dark:bg-slate-950/35 lg:max-h-[min(92vh,960px)] lg:flex-1 lg:basis-0 lg:border-t-0 lg:border-l lg:border-slate-200/70 lg:overflow-y-auto dark:lg:border-slate-700/80">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                素材区
              </h4>
              <button
                type="button"
                onClick={() => setMaterialPanelOpen(false)}
                className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-expanded={true}
              >
                收起
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              点击图片放大，可用两侧按钮或键盘 ← → 切换；右上角 + 选用，已选图显示在左侧检索词下方。
            </p>

            {materialCache ? (
              <section className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    缓存帖子配图
                  </p>
                  {onLoadNextMaterialBatch && materialCache.notes.length > 0 ? (
                    <button
                      type="button"
                      disabled={materialCache.loading || !materialCache.hasMore}
                      onClick={() => void onLoadNextMaterialBatch()}
                      className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      title={
                        materialCache.hasMore ? "按相同检索条件加载下一批帖子" : "已是最后一批"
                      }
                    >
                      {materialCache.loading ? "加载中…" : "换一批"}
                    </button>
                  ) : null}
                </div>
                {materialCache.loading ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    正在同步缓存列表…
                  </p>
                ) : (
                  <>
                    {materialCache.hint ? (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {materialCache.hint}
                      </p>
                    ) : materialCache.notes.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        生成后将根据检索词与垂类拉取缓存并匹配参考链接。
                      </p>
                    ) : null}
                    {materialCache.notes.length > 0 ? (
                      <ul className="mt-3 space-y-3">
                        {materialCache.notes.map((n) => {
                          const imgs = extractMaterialImageUrls(n.image_list);
                          return (
                            <li
                              key={n.note_id}
                              className="rounded-lg border border-slate-200/90 bg-white/80 p-2.5 dark:border-slate-700 dark:bg-slate-900/50"
                            >
                              <div className="flex min-w-0 items-start justify-between gap-2">
                                <a
                                  href={n.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-w-0 flex-1 text-sm font-medium text-rose-800 underline-offset-2 hover:underline dark:text-rose-200"
                                >
                                  {n.title || "（无标题）"}
                                </a>
                                <span className="shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                                  {n.note_id.slice(0, 8)}…
                                </span>
                              </div>
                              {imgs.length > 0 ? (
                                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 pt-0.5 [-webkit-overflow-scrolling:touch]">
                                  {imgs.slice(0, 18).map((src, idx) => (
                                    <MaterialImageThumb
                                      key={`${n.note_id}-${idx}`}
                                      src={src}
                                      noteId={n.note_id}
                                      noteTitle={n.title || "（无标题）"}
                                      noteUrl={n.url}
                                      index={idx}
                                      selected={selectedKeySet.has(
                                        materialImageKey(n.note_id, src, idx),
                                      )}
                                      onPreview={setPreviewImage}
                                      onToggleSelect={toggleSelectedImage}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                  本条缓存暂无配图 URL，可点开标题在原文中查看。
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>

      {previewImage && lightboxImages.length > 0 ? (
        <MaterialImageLightbox
          images={lightboxImages}
          index={lightboxIndex}
          selectedKeySet={selectedKeySet}
          onClose={() => setPreviewImage(null)}
          onChangeIndex={(i) => setPreviewImage(lightboxImages[i] ?? null)}
          onToggleSelect={toggleSelectedImage}
        />
      ) : null}

      {resolvedFooter ? (
        <div className="border-t border-rose-200/60 bg-rose-50/30 px-4 py-4 dark:border-rose-900/40 dark:bg-rose-950/20">
          <div className="flex w-full flex-col items-end gap-3 text-right">{resolvedFooter}</div>
        </div>
      ) : null}
    </div>
  );
}
