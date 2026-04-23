import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isAgentId } from "../agents";
import AssistantClient from "../AssistantClient";

type Props = {
  params: Promise<{ agent: string }>;
};

export default async function AgentAssistantPage({ params }: Props) {
  const { agent } = await params;
  if (!isAgentId(agent)) notFound();
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
      <AssistantClient agentId={agent} />
    </Suspense>
  );
}
