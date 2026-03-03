export type ContentBlockType = "text" | "image" | "thinking" | "toolCall";

export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  mimeType?: string;
  data?: string;
}

export type MessageRole = "user" | "assistant" | "tool" | "system";
export type MessageType =
  | "user"
  | "assistant"
  | "toolResult"
  | "compactionSummary"
  | "branchSummary"
  | "custom";
export type QueueBehavior = "steer" | "followUp";

export interface BaseMessageEntry<
  TType extends MessageType,
  TRole extends MessageRole,
> {
  type: TType;
  role: TRole;
  id: string;
  parentId?: string;
  timestamp: string;
  content: ContentBlock[];
}

export interface UserMessageEntry extends BaseMessageEntry<"user", "user"> {
  content: [ContentBlock, ...ContentBlock[]];
}

export interface AssistantMessageEntry
  extends BaseMessageEntry<"assistant", "assistant">
{
  model?: string;
}

export interface ToolResultMessageEntry
  extends BaseMessageEntry<"toolResult", "tool">
{
  toolCallId: string;
  toolName?: string;
  isError?: boolean;
}

export interface CompactionSummaryMessageEntry
  extends BaseMessageEntry<"compactionSummary", "system">
{
  content: [
    {
      type: "text";
      text: string;
    },
  ];
}

export interface BranchSummaryMessageEntry
  extends BaseMessageEntry<"branchSummary", "system">
{
  content: [
    {
      type: "text";
      text: string;
    },
  ];
}

export interface CustomMessageEntry
  extends BaseMessageEntry<"custom", MessageRole>
{
  kind: string;
}

export type AgentMessage =
  | UserMessageEntry
  | AssistantMessageEntry
  | ToolResultMessageEntry
  | CompactionSummaryMessageEntry
  | BranchSummaryMessageEntry
  | CustomMessageEntry;

export type AgentEventType =
  | "agent_start"
  | "turn_start"
  | "text_start"
  | "text_delta"
  | "text_end"
  | "thinking_start"
  | "thinking_delta"
  | "thinking_end"
  | "toolcall_start"
  | "toolcall_delta"
  | "toolcall_end"
  | "done"
  | "error"
  | "abort";

export interface BaseAgentEvent {
  type: AgentEventType;
  sessionId: string;
  turnId: string;
  at: string;
}

export interface TextEvent extends BaseAgentEvent {
  type: "text_start" | "text_delta" | "text_end";
  text?: string;
}

export interface ThinkingEvent extends BaseAgentEvent {
  type: "thinking_start" | "thinking_delta" | "thinking_end";
  thinking?: string;
}

export interface ToolCallEvent extends BaseAgentEvent {
  type: "toolcall_start" | "toolcall_delta" | "toolcall_end";
  toolCallId: string;
  toolName?: string;
  payload?: string;
}

export interface ErrorEvent extends BaseAgentEvent {
  type: "error";
  code: string;
  message: string;
}

export interface DoneEvent extends BaseAgentEvent {
  type: "done";
  stopReason: "stop" | "tool" | "max_tokens";
}

export type AgentEvent =
  | BaseAgentEvent
  | TextEvent
  | ThinkingEvent
  | ToolCallEvent
  | ErrorEvent
  | DoneEvent;

export interface RequestBase {
  id?: string;
}

export interface SteerRequest extends RequestBase {
  queue: "steer";
  content: string;
}

export interface FollowUpRequest extends RequestBase {
  queue: "followUp";
  content: string;
}

export type QueueRequest = SteerRequest | FollowUpRequest;

export interface SessionHeader {
  version: 3;
  id: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SessionEntry {
  version: 3;
  header: SessionHeader;
  messages: AgentMessage[];
}

export function isAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    "id" in candidate
    && "role" in candidate
    && "type" in candidate
    && typeof candidate.id === "string"
    && typeof candidate.role === "string"
    && typeof candidate.type === "string"
  );
}
