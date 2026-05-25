import { create } from "zustand";

export interface ChatMessage {
  id: string;
  sessionId: string;
  agentId?: string;
  agentRole?: string;  // critic | planner | coder | reviewer
  role: "user" | "agent" | "system";
  content: string;
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
  status: "pending" | "in_progress" | "review" | "done" | "blocked" | "retry" | "dispute";
  result?: string;
  error?: string;
}

export interface DAGTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  agent_role: string;
  db_id: string;
}

export interface PlanData {
  messageId: string;
  approaches: Approach[];
  selectedApproach?: string;
}

export interface ConfirmedPlan {
  messageId: string;
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
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  appendStreamToken: (sessionId: string, msgId: string, token: string) => void;
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
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  plans: {},
  confirmedPlans: {},
  tasks: {},
  artifacts: {},
  connectionStatus: "disconnected",
  selectedContactId: null,
  pendingSend: null,
  replyTarget: null,

  setSessions: (sessions) => set({ sessions }),
  setSelectedContact: (id) => set({ selectedContactId: id }),
  setActiveSession: (id) => set({ activeSessionId: id }),

  addMessage: (sessionId, msg) =>
    set((state) => {
      const prev = state.messages[sessionId] || [];
      // If message with same id already exists (from streaming), replace it
      const existingIdx = prev.findIndex((m) => m.id === msg.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = msg;
        return { messages: { ...state.messages, [sessionId]: updated } };
      }
      return {
        messages: { ...state.messages, [sessionId]: [...prev, msg] },
      };
    }),

  appendStreamToken: (sessionId, msgId, token) =>
    set((state) => {
      const prev = state.messages[sessionId] || [];
      const existingIdx = prev.findIndex((m) => m.id === msgId);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], content: updated[existingIdx].content + token };
        return { messages: { ...state.messages, [sessionId]: updated } };
      }
      // Create a new streaming placeholder
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
}));
