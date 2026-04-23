import { NextRequest, NextResponse } from "next/server";
import { isAgentId, type AgentId } from "@/app/assistant/agents";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";

const AGENT_SYSTEM_PROMPTS: Record<AgentId, string> = {
  xiaohongshu: [
    "你是「小红书内容生成」专用助手。用户会描述主题、产品或场景，你需要输出适合发布在小红书的笔记正文。",
    "要求：用中文；语气自然、有代入感；可适当使用分段、emoji、话题标签（#标签#）；避免违规医疗/绝对化用语；若信息不足先简短追问再写。",
    "除非用户只要标题，否则默认给出完整笔记（可含标题行 + 正文 + 标签建议）。",
  ].join(""),
  cases: [
    "你是「法律案例查询」专用助手。用户会描述案由、法条、事实要点或关键词，你需要围绕法律案例进行检索式解读。",
    "要求：用中文；先复述需求；再分条输出“争议焦点、裁判要点、适用法条、可检索关键词”；信息不足时先追问。",
    "不要编造具体法院案号或判决细节；若无法确认请明确说明不确定性。你的输出仅作信息参考，不构成法律意见。",
  ].join(""),
};

const DEFAULT_SYSTEM =
  "你是一个友好、专业的 AI 智能助手，用中文回答用户问题。回答要清晰、有条理。";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "请设置环境变量 DEEPSEEK_API_KEY" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { messages, agent: agentRaw } = body as {
      messages: Array<{ role: string; content: string }>;
      agent?: string;
    };

    if (!messages?.length) {
      return NextResponse.json(
        { error: "请提供 messages 数组" },
        { status: 400 }
      );
    }

    const agent: AgentId | undefined =
      agentRaw && isAgentId(agentRaw) ? agentRaw : undefined;
    const systemContent = agent
      ? AGENT_SYSTEM_PROMPTS[agent]
      : DEFAULT_SYSTEM;

    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    const response = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: systemContent,
          },
          ...messages,
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("DeepSeek API 错误:", response.status, err);
      return NextResponse.json(
        { error: `AI 服务请求失败: ${response.status}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content =
      data.choices?.[0]?.message?.content ?? "抱歉，没有收到有效回复。";

    return NextResponse.json({ content });
  } catch (e) {
    console.error("Chat API 异常:", e);
    const message = e instanceof Error ? e.message : "服务器处理请求时出错";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
