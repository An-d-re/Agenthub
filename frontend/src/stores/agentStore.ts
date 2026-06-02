import { create } from "zustand";

export interface AgentItem {
  id: string;
  name: string;
  avatarUrl: string;
  roleType: string;
  adapterType: string;
  systemPrompt?: string;
  capabilityTags?: string[];
  isDeletable: boolean;
}

interface AgentState {
  agents: AgentItem[];
  setAgents: (agents: AgentItem[]) => void;
  addAgent: (agent: AgentItem) => void;
  removeAgent: (id: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  setAgents: (agents) => set({ agents }),
  addAgent: (agent) => set((s) => ({ agents: [...s.agents, agent] })),
  removeAgent: (id) =>
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),
}));
