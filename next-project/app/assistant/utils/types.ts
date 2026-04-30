export type MessageReference = {
  title: string;
  url: string;
};

export type MessageSearchMeta = {
  queryCount: number;
  queryTerms: string[];
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  references?: MessageReference[];
  searchMeta?: MessageSearchMeta;
  coverImagePath?: string;
};

export type McpStreamEvent = {
  event: string;
  data: unknown;
};
