import { create } from "zustand";

export interface ChatMessage {
  id: string;
  sessionId: string;
  agentId?: string;
  agentRole?: string;  // critic | planner | coder | reviewer
  role: "user" | "agent" | "system";
  content: string;
  reasoning?: string;  // 深度思考内容
  reasoningId?: string;
  messageType: string;
  parentId?: string;
  codeSelection?: { start_line: number; end_line: number; message_id: string };
  fileName?: string;
  fileUrl?: string;
  fileSize?: number;
  createdAt: string;
}

export interface SessionItem {
  id: string;
  title: string;
  type: string;
  status: string;
  agentCount: number;
  agentIds: string[];
  lastMessagePreview: string;
}

export interface Approach {
  name: string;
  summary: string;
  pros: string[];
  cons: string[];
  recommended: boolean;
}

export interface ArtifactItem {
  artifactId: string;
  taskId?: string;
  filePath: string;
  language: string;
  contentPreview?: string;
  originalContent?: string;
  modifiedContent?: string;
}

export interface TraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  operation_name: string;
  service_name: string;
  status: string;
  duration_ms: number;
  tags?: Record<string, unknown>;
}

export interface TaskItem {
  taskId: string;
  title: string;
  description?: string;
  status: "pending" | "running" | "reviewing" | "done" | "blocked" | "retrying" | "failed" | "dispute" | "cancelled";
  result?: string;
  error?: string;
  retryCount?: number;
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface DAGTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  required_capability: string;  // calculate | code | verify | design | analyze | write | data
  executor_type: "existing" | "new";  // 复用现有 Agent 还是新建
  agent_id: string | null;
  agent_name: string | null;
  match_reason: string;
  // 用户选择（DAG 确认时）
  selected_agent_id?: string | null;   // 用户选中的现有 Agent ID
  selected_adapter_type?: string;      // 用户为"新建"选的模型
  selected_api_key?: string;           // 用户输入的 API Key（仅当模型未配置时）
  db_id: string;
}

export interface ModelOption {
  adapter_type: string;
  name: string;
  icon: string;
  description: string;
  available: boolean;   // 已配置 API Key
  needs_key: boolean;   // 需要用户提供 Key
}

export interface PlanData {
  messageId: string;
  approaches: Approach[];
  selectedApproach?: string;
}

export interface ConfirmedPlan {
  tasks: DAGTask[];
  hint: string;
}

export interface ReplyTarget {
  messageId: string;
  content: string;
  role: string;
  fileName?: string;
}

export interface TaskData {
  tasks: TaskItem[];
}

interface ChatState {
  sessions: SessionItem[];
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  plans: Record<string, PlanData>;          // sessionId → plan
  confirmedPlans: Record<string, ConfirmedPlan>; // sessionId → confirmed DAG
  tasks: Record<string, TaskItem[]>;         // sessionId → tasks
  artifacts: Record<string, ArtifactItem[]>;  // sessionId → artifacts
  connectionStatus: "disconnected" | "connecting" | "connected";

  selectedContactId: string | null;
  setSessions: (sessions: SessionItem[]) => void;
  setSelectedContact: (id: string | null) => void;
  setActiveSession: (id: string | null) => void;
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  appendStreamToken: (sessionId: string, msgId: string, token: string) => void;
  appendReasoningToken: (sessionId: string, msgId: string, reasoningId: string, token: string) => void;
  setMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  setConnectionStatus: (status: "disconnected" | "connecting" | "connected") => void;
  setPlan: (sessionId: string, plan: PlanData) => void;
  setSelectedApproach: (sessionId: string, name: string) => void;
  setConfirmedPlan: (sessionId: string, plan: ConfirmedPlan) => void;
  clearConfirmedPlan: (sessionId: string) => void;
  removeDagTask: (sessionId: string, taskId: string) => void;
  upsertTask: (sessionId: string, task: TaskItem) => void;
  setTasks: (sessionId: string, tasks: TaskItem[]) => void;
  addArtifact: (sessionId: string, artifact: ArtifactItem) => void;
  pendingSend: string | null;
  setPendingSend: (msg: string | null) => void;
  replyTarget: ReplyTarget | null;
  setReplyTarget: (target: ReplyTarget | null) => void;
  traceSpans: Record<string, TraceSpan[]>;
  addTraceSpan: (sessionId: string, span: TraceSpan) => void;
  _finalizedIds: Set<string>;  // 已完成的消息 ID，防止流式 token 覆盖
  sessionAgentIds: Record<string, string[]>;
  initSessionAgents: (sessionId: string, ids: string[]) => void;
  addSessionAgent: (sessionId: string, agentId: string) => void;
  removeSessionAgent: (sessionId: string, agentId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  _finalizedIds: new Set(),
  plans: {},
  confirmedPlans: {},
  tasks: {},
  artifacts: {},
  connectionStatus: "disconnected",
  selectedContactId: null,
  pendingSend: null,
  replyTarget: null,
  traceSpans: {},

  setSessions: (sessions) => set({ sessions }),
  setSelectedContact: (id) => set({ selectedContactId: id }),
  setActiveSession: (id) => set({ activeSessionId: id }),

  addMessage: (sessionId, msg) =>
    set((state) => {
      const prev = state.messages[sessionId] || [];
      const existingIdx = prev.findIndex((m) => m.id === msg.id);
      const finalized = new Set(state._finalizedIds);
      // 有实际内容的消息标记为已完成
      if (msg.content) finalized.add(msg.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        // 保留流式阶段的深度思考内容（最终消息不含 reasoning）
        const existing = updated[existingIdx];
        updated[existingIdx] = {
          ...msg,
          reasoning: msg.reasoning || existing.reasoning,
          reasoningId: msg.reasoningId || existing.reasoningId,
        };
        return { messages: { ...state.messages, [sessionId]: updated }, _finalizedIds: finalized };
      }
      return {
        messages: { ...state.messages, [sessionId]: [...prev, msg] },
        _finalizedIds: finalized,
      };
    }),

  appendStreamToken: (sessionId, msgId, token) =>
    set((state) => {
      // 若最终消息已到达，忽略迟到的流式 token（防止覆盖完整内容）
      if (state._finalizedIds.has(msgId)) return state;
      const prev = state.messages[sessionId] || [];
      const existingIdx = prev.findIndex((m) => m.id === msgId);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], content: updated[existingIdx].content + token };
        return { messages: { ...state.messages, [sessionId]: updated } };
      }
      return {
        messages: {
          ...state.messages,
          [sessionId]: [...prev, {
            id: msgId,
            sessionId,
            role: "agent",
            content: token,
            messageType: "text",
            createdAt: new Date().toISOString(),
          }],
        },
      };
    }),

  appendReasoningToken: (sessionId, msgId, reasoningId, token) =>
    set((state) => {
      // 找到对应的消息（可能由 reasoning token 首次创建，或已存在）
      const prev = state.messages[sessionId] || [];
      // 优先通过主消息 ID 找
      const existingIdx = prev.findIndex((m) => m.id === msgId);
      if (existingIdx < 0) {
        // 如果主消息还没创建（reasoning 比 content 先到），创建占位
        return {
          messages: {
            ...state.messages,
            [sessionId]: [...prev, {
              id: msgId,
              sessionId,
              role: "agent",
              content: "",
              reasoning: token,
              reasoningId,
              messageType: "text",
              createdAt: new Date().toISOString(),
            }],
          },
        };
      }
      const updated = [...prev];
      const msg = updated[existingIdx];
      updated[existingIdx] = {
        ...msg,
        reasoning: (msg.reasoning || "") + token,
        reasoningId: reasoningId,
      };
      return { messages: { ...state.messages, [sessionId]: updated } };
    }),

  setMessages: (sessionId, msgs) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: msgs },
    })),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setPlan: (sessionId, plan) =>
    set((state) => ({
      plans: { ...state.plans, [sessionId]: plan },
    })),

  setSelectedApproach: (sessionId, name) =>
    set((state) => {
      const plan = state.plans[sessionId];
      if (!plan) return state;
      return {
        plans: {
          ...state.plans,
          [sessionId]: { ...plan, selectedApproach: name },
        },
      };
    }),

  setConfirmedPlan: (sessionId, plan) =>
    set((state) => ({
      confirmedPlans: { ...state.confirmedPlans, [sessionId]: plan },
    })),

  clearConfirmedPlan: (sessionId) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [sessionId]: _, ...rest } = state.confirmedPlans;
      return { confirmedPlans: rest };
    }),

  removeDagTask: (sessionId, taskId) =>
    set((state) => {
      const plan = state.confirmedPlans[sessionId];
      if (!plan) return state;
      const updatedTasks = plan.tasks
        .filter((t) => t.id !== taskId)
        .map((t) => ({
          ...t,
          dependencies: t.dependencies.filter((d) => d !== taskId),
        }));
      return {
        confirmedPlans: {
          ...state.confirmedPlans,
          [sessionId]: { ...plan, tasks: updatedTasks },
        },
      };
    }),

  upsertTask: (sessionId, task) =>
    set((state) => {
      const existing = state.tasks[sessionId] || [];
      const idx = existing.findIndex((t) => t.taskId === task.taskId);
      const updated =
        idx >= 0
          ? [...existing.slice(0, idx), task, ...existing.slice(idx + 1)]
          : [...existing, task];
      return { tasks: { ...state.tasks, [sessionId]: updated } };
    }),

  setTasks: (sessionId, tasks) =>
    set((state) => ({
      tasks: { ...state.tasks, [sessionId]: tasks },
    })),

  addArtifact: (sessionId, artifact) =>
    set((state) => ({
      artifacts: {
        ...state.artifacts,
        [sessionId]: [...(state.artifacts[sessionId] || []), artifact],
      },
    })),

  setPendingSend: (msg) => set({ pendingSend: msg }),
  setReplyTarget: (target) => set({ replyTarget: target }),

  sessionAgentIds: {},
  initSessionAgents: (sessionId, ids) =>
    set((state) => ({
      sessionAgentIds: { ...state.sessionAgentIds, [sessionId]: ids },
    })),
  addSessionAgent: (sessionId, agentId) =>
    set((state) => {
      const existing = state.sessionAgentIds[sessionId] || [];
      if (existing.includes(agentId)) return state;
      return {
        sessionAgentIds: {
          ...state.sessionAgentIds,
          [sessionId]: [...existing, agentId],
        },
      };
    }),
  removeSessionAgent: (sessionId, agentId) =>
    set((state) => ({
      sessionAgentIds: {
        ...state.sessionAgentIds,
        [sessionId]: (state.sessionAgentIds[sessionId] || []).filter((id) => id !== agentId),
      },
    })),

  addTraceSpan: (sessionId, span) =>
    set((state) => ({
      traceSpans: {
        ...state.traceSpans,
        [sessionId]: [...(state.traceSpans[sessionId] || []), span],
      },
    })),
}));

// Expose store for E2E testing
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__CHAT_STORE__ = useChatStore;
}
