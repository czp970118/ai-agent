export const AGENTS = ["xiaohongshu", "cases"] as const;

export type AgentId = (typeof AGENTS)[number];

export function isAgentId(value: string): value is AgentId {
  return (AGENTS as readonly string[]).includes(value);
}

export type AgentUiConfig = {
  title: string;
  badge: string;
  shortLabel: string;
  emptyTitle: string;
  emptyHint: string;
  emptyEmoji: string;
  placeholder: string;
  shellFrom: string;
  shellTo: string;
  shellFromDark: string;
  shellToDark: string;
  headerBorder: string;
  headerBg: string;
  badgeBg: string;
  badgeText: string;
  titleText: string;
  accentIconBg: string;
  userBubble: string;
  sendBtn: string;
  focusRing: string;
};

export const agentUi: Record<AgentId, AgentUiConfig> = {
  xiaohongshu: {
    title: "小红书内容 Agent",
    badge: "任务：自动生成小红书笔记",
    shortLabel: "小红书",
    emptyTitle: "描述主题或产品，我来写笔记",
    emptyHint: "可说明风格（种草 / 测评 / 教程）、字数、是否要话题标签",
    emptyEmoji: "📕",
    placeholder: "例如：帮我写一篇防晒霜种草笔记，语气活泼…",
    shellFrom: "from-rose-50",
    shellTo: "to-orange-50/80",
    shellFromDark: "dark:from-rose-950/90",
    shellToDark: "dark:to-orange-950/40",
    headerBorder: "border-rose-200/80 dark:border-rose-900/80",
    headerBg: "bg-rose-50/90 dark:bg-rose-950/70",
    badgeBg: "bg-rose-500/15 dark:bg-rose-400/15",
    badgeText: "text-rose-800 dark:text-rose-200",
    titleText: "text-rose-950 dark:text-rose-50",
    accentIconBg: "bg-rose-500/15 dark:bg-rose-400/10",
    userBubble: "bg-rose-600 text-white rounded-br-md",
    sendBtn: "bg-rose-600 hover:bg-rose-700 focus:ring-rose-500",
    focusRing: "focus:ring-rose-500",
  },
  cases: {
    title: "法律案例查询 Agent",
    badge: "任务：检索与解读法律案例",
    shortLabel: "法律案例",
    emptyTitle: "请输入案由、法条或关键词",
    emptyHint: "我会按法律案例场景整理要点，并标注争议焦点与裁判思路",
    emptyEmoji: "🔍",
    placeholder: "例如：劳动争议中“违法解除劳动合同”的裁判案例…",
    shellFrom: "from-teal-50",
    shellTo: "to-cyan-50/80",
    shellFromDark: "dark:from-teal-950/90",
    shellToDark: "dark:to-cyan-950/40",
    headerBorder: "border-teal-200/80 dark:border-teal-900/80",
    headerBg: "bg-teal-50/90 dark:bg-teal-950/70",
    badgeBg: "bg-teal-600/15 dark:bg-teal-400/15",
    badgeText: "text-teal-900 dark:text-teal-100",
    titleText: "text-teal-950 dark:text-teal-50",
    accentIconBg: "bg-teal-500/15 dark:bg-teal-400/10",
    userBubble: "bg-teal-600 text-white rounded-br-md",
    sendBtn: "bg-teal-600 hover:bg-teal-700 focus:ring-teal-500",
    focusRing: "focus:ring-teal-500",
  },
};
