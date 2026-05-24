import { create } from "zustand";

export interface ChatMessage {
  id: string;
  sessionId: string;
  agentId?: string;
  role: "user" | "agent" | "system";
  content: string;
  messageType: string;
  parentId?: string;
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

export interface PlanData {
  messageId: string;
  approaches: Approach[];
  selectedApproach?: string;
}

export interface TaskData {
  tasks: TaskItem[];
}

interface ChatState {
  sessions: SessionItem[];
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  plans: Record<string, PlanData>;          // sessionId → plan
  tasks: Record<string, TaskItem[]>;         // sessionId → tasks
  artifacts: Record<string, ArtifactItem[]>;  // sessionId → artifacts
  connectionStatus: "disconnected" | "connecting" | "connected";

  selectedContactId: string | null;
  setSessions: (sessions: SessionItem[]) => void;
  setSelectedContact: (id: string | null) => void;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  setMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  setConnectionStatus: (status: "disconnected" | "connecting" | "connected") => void;
  setPlan: (sessionId: string, plan: PlanData) => void;
  setSelectedApproach: (sessionId: string, name: string) => void;
  upsertTask: (sessionId: string, task: TaskItem) => void;
  setTasks: (sessionId: string, tasks: TaskItem[]) => void;
  addArtifact: (sessionId: string, artifact: ArtifactItem) => void;
  pendingSend: string | null;
  setPendingSend: (msg: string | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  plans: {},
  tasks: {},
  artifacts: {},
  connectionStatus: "disconnected",
  selectedContactId: null,
  pendingSend: null,

  setSessions: (sessions) => set({ sessions }),
  setSelectedContact: (id) => set({ selectedContactId: id }),
  setActiveSession: (id) => set({ activeSessionId: id }),

  addMessage: (sessionId, msg) =>
    set((state) => {
      const prev = state.messages[sessionId] || [];
      return {
        messages: { ...state.messages, [sessionId]: [...prev, msg] },
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
}));
