"use client";

import { useEffect, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AgentPlaceholderIcon } from "@/lib/agentIcons";

const PRESET_SKILLS = [
  { id: "code-generation", label: "代码生成", icon: "📝", tag: "代码生成" },
  { id: "code-review", label: "代码审查", icon: "🔍", tag: "代码审查" },
  { id: "sql-optimization", label: "SQL 优化", icon: "🗄️", tag: "数据库" },
  { id: "documentation", label: "文档撰写", icon: "📄", tag: "文档" },
  { id: "web-development", label: "Web 开发", icon: "🌐", tag: "Web开发" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  editAgent?: { id: string; name: string; systemPrompt: string; skills: string[]; capabilityTags: string[]; avatarUrl: string } | null;
  onCreated?: (agentId: string) => void;
}

export function AgentEditor({ open, onClose, editAgent, onCreated }: Props) {
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const addAgent = useAgentStore(s => s.addAgent);
  const setAgents = useAgentStore(s => s.setAgents);
  const agents = useAgentStore(s => s.agents);

  useEffect(() => {
    if (editAgent) {
      setName(editAgent.name);
      setSystemPrompt(editAgent.systemPrompt);
      setSelectedSkills(editAgent.skills || []);
      setCustomTags(editAgent.capabilityTags || []);
      setAvatarUrl(editAgent.avatarUrl || "");
    } else {
      setName(""); setSystemPrompt(""); setSelectedSkills([]); setCustomTags([]); setAvatarUrl("");
    }
    setError("");
  }, [editAgent, open]);

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev => prev.includes(id) ? prev.filter(s => s !== id) : prev.length < 5 ? [...prev, id] : prev);
  };

  const derivedTags = selectedSkills.flatMap(sid => {
    const skill = PRESET_SKILLS.find(s => s.id === sid);
    return skill ? [skill.tag] : [];
  }).filter((v, i, a) => a.indexOf(v) === i);

  const allTags = [...derivedTags, ...customTags].filter((v, i, a) => a.indexOf(v) === i);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !allTags.includes(t) && allTags.length < 10) {
      setCustomTags([...customTags, t]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setCustomTags(customTags.filter(t => t !== tag));
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true); setError("");
    try {
      const payload = {
        name: name.trim(),
        role_type: "custom",
        adapter_type: "deepseek",
        system_prompt: systemPrompt,
        skills: selectedSkills,
        capability_tags: allTags,
        avatar_url: avatarUrl,
      };
      let res;
      if (editAgent) {
        res = await fetch(`${API_BASE}/api/agents/${editAgent.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`${API_BASE}/api/agents`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (res.ok) {
        const data = await res.json();
        if (editAgent) {
          setAgents(agents.map(a => a.id === editAgent.id ? { ...a, name: data.name, systemPrompt: data.system_prompt, capabilityTags: data.capability_tags, avatarUrl: data.avatar_url } : a));
        } else {
          addAgent({ id: data.id, name: data.name, avatarUrl: data.avatar_url || "", roleType: data.role_type, adapterType: data.adapter_type, capabilityTags: data.capability_tags || [], isDeletable: data.is_deletable });
          onCreated?.(data.id);
        }
        onClose();
      } else {
        setError("保存失败，请重试");
      }
    } catch {
      setError("网络错误，保存失败");
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/10" onClick={onClose} />
      {/* Slide-in panel */}
      <div className="relative ml-auto w-[min(720px,65vw)] h-full bg-white dark:bg-[var(--bg-primary)] shadow-2xl animate-slide-in-right flex flex-col text-[var(--text-primary)] dark:text-[var(--text-primary)]"
        style={{ animation: "slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bg-secondary)] transition-colors text-[var(--text-secondary)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h2 className="text-[17px] font-semibold text-[var(--text-primary)] dark:text-[var(--text-primary)]">{editAgent ? "编辑 Agent" : "创建自定义 Agent"}</h2>
          </div>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="px-6 py-2.5 rounded-[12px] bg-[var(--accent)] text-white text-[14px] font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex gap-8">
            {/* Avatar column */}
            <div className="shrink-0 flex flex-col items-center gap-3">
              <div className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center text-3xl",
                avatarUrl ? "bg-cover bg-center" : "bg-[var(--bg-secondary)]"
              )} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : {}}>
                {!avatarUrl && <AgentPlaceholderIcon size={20} />}
              </div>
              <button onClick={() => {
                const url = prompt("输入头像 URL:");
                if (url) setAvatarUrl(url);
              }} className="text-[12px] text-[var(--accent)] hover:underline">修改头像</button>
              <div className="mt-4">
                <p className="text-[11px] text-[var(--text-secondary)] mb-2 text-center">能力标签</p>
                <div className="flex flex-wrap gap-1 justify-center">
                  {allTags.length > 0 ? allTags.map(t => (
                    <span key={t} className="text-[11px] bg-[var(--border)] text-[var(--text-primary)] rounded-md px-1.5 py-0.5">{t}</span>
                  )) : (
                    <span className="text-[11px] text-[var(--text-tertiary)]">无能力标签</span>
                  )}
                </div>
              </div>
            </div>

            {/* Form column */}
            <div className="flex-1 space-y-5">
              {/* Name */}
              <div>
                <label className="text-[13px] font-medium text-[var(--text-primary)] mb-1.5 block">Agent 名称</label>
                <input value={name} onChange={e => setName(e.target.value.slice(0, 20))}
                  placeholder="例如：SQL 优化专家"
                  className={cn(
                    "w-full px-4 py-3 rounded-[12px] bg-[var(--bg-secondary)] border-0 outline-none text-[15px] placeholder:text-[var(--text-tertiary)] transition-colors focus:bg-white dark:focus:bg-[var(--bg-secondary)] focus:ring-2",
                    name.length >= 20 ? "ring-2 ring-[var(--danger)]" : "focus:ring-[var(--accent)]/20"
                  )} />
                <div className="flex justify-between mt-1">
                  {name.length >= 20 && <span className="text-[11px] text-[var(--danger)]">名称不能超过 20 个字符</span>}
                  <span className="text-[11px] text-[var(--text-tertiary)] ml-auto">{name.length}/20</span>
                </div>
              </div>

              {/* System Prompt */}
              <div>
                <label className="text-[13px] font-medium text-[var(--text-primary)] mb-1.5 block">系统 Prompt</label>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value.slice(0, 2000))}
                  placeholder="设定 Agent 的角色、个性、知识范围..."
                  className="w-full px-4 py-3 rounded-[12px] bg-[var(--bg-secondary)] border-0 outline-none text-[14px] placeholder:text-[var(--text-tertiary)] resize-y min-h-[200px] leading-relaxed transition-colors focus:bg-white dark:focus:bg-[var(--bg-secondary)] focus:ring-2 focus:ring-[var(--accent)]/20"
                  style={{ resize: "vertical" }}
                />
                <div className="text-right text-[11px] text-[var(--text-tertiary)] mt-1">{systemPrompt.length}/2000</div>
              </div>

              {/* Capability Tags */}
              <div>
                <label className="text-[13px] font-medium text-[var(--text-primary)] mb-2 block">能力标签 <span className="text-[var(--text-tertiary)] font-normal">(最多 10 个)</span></label>
                <div className="flex gap-2 mb-2">
                  <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    placeholder="输入技术标签，如 python, react, sql..."
                    className="flex-1 px-3 py-2 rounded-[8px] bg-[var(--bg-secondary)] border-0 outline-none text-[13px] placeholder:text-[var(--text-tertiary)] focus:ring-2 focus:ring-[var(--accent)]/20" />
                  <button onClick={addTag}
                    className="px-4 py-2 rounded-[8px] bg-[var(--accent)] text-white text-[13px] font-medium hover:bg-[var(--accent-hover)] transition-colors">添加</button>
                </div>
                {allTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map(t => (
                      <span key={t} className={cn(
                        "inline-flex items-center gap-1 text-[12px] rounded-md px-2 py-1",
                        derivedTags.includes(t) ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      )}>
                        {t}
                        {customTags.includes(t) && (
                          <button onClick={() => removeTag(t)} className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-red-100 text-[var(--text-tertiary)] hover:text-[var(--danger)]">&times;</button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Skills */}
              <div>
                <label className="text-[13px] font-medium text-[var(--text-primary)] mb-2 block">预置 Skill 库 <span className="text-[var(--text-tertiary)] font-normal">(最多 5 个)</span></label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_SKILLS.map(skill => {
                    const sel = selectedSkills.includes(skill.id);
                    return (
                      <button key={skill.id} onClick={() => toggleSkill(skill.id)}
                        className={cn(
                          "px-4 py-2 rounded-[8px] text-[13px] font-medium transition-all duration-150",
                          sel
                            ? "bg-[var(--accent)] text-white shadow-sm"
                            : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
                        )}>
                        {skill.icon} {skill.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && <div className="px-8 pb-2 text-[13px] text-[var(--danger)] text-center">{error}</div>}

        {/* Footer */}
        <div className="flex justify-end gap-3 px-8 py-4 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-6 py-2.5 text-[14px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">取消</button>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
