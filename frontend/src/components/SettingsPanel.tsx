"use client";

import { useState, useEffect } from "react";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface ModelVariant {
  id: string;
  name: string;
  description: string;
}

interface ProviderData {
  models: ModelVariant[];
  selected_model: string;
  has_key: boolean;
}

interface ProviderSettings {
  api_key: string;
  model: string;
  has_key: boolean;
}

interface TestResult {
  ok: boolean;
  latency_ms?: number;
  error?: string;
}

const DOT: Record<string, string> = {
  deepseek:  "bg-purple-500",
  anthropic: "bg-amber-400",
  opencode:   "bg-cyan-400",
};

interface Props { open: boolean; onClose: () => void; }

export function SettingsPanel({ open, onClose }: Props) {
  const [catalog, setCatalog] = useState<Record<string, ProviderData>>({});
  const [settings, setSettings] = useState<Record<string, ProviderSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, TestResult | null>>({});

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/settings/models`).then(r => r.json()),
      fetch(`${API_BASE}/api/settings`).then(r => r.json()),
    ])
      .then(([catalogData, settingsData]) => {
        setCatalog(catalogData.providers || {});
        const provs: Record<string, ProviderSettings> = {};
        const dk: Record<string, string> = {};
        for (const [k, v] of Object.entries(settingsData.providers || {})) {
          const sv = v as Record<string, unknown>;
          provs[k] = { api_key: sv.api_key as string, model: sv.model as string, has_key: sv.has_key as boolean };
          dk[k] = "";
        }
        setSettings(provs);
        setDraftKeys(dk);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const handleSaveProvider = async (at: string) => {
    const key = draftKeys[at];
    if (!key) return;

    setSaving(prev => ({ ...prev, [at]: true }));
    setTestResult(prev => ({ ...prev, [at]: null }));

    // 1. 先测试连接
    let testOk = false;
    try {
      const tr = await fetch(`${API_BASE}/api/settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter_type: at, api_key: key }),
      });
      const result: TestResult = await tr.json();
      setTestResult(prev => ({ ...prev, [at]: result }));
      testOk = result.ok;
    } catch {
      setTestResult(prev => ({ ...prev, [at]: { ok: false, error: "网络请求失败" } }));
    }

    // 2. 测试通过才保存
    if (testOk) {
      const body = { [at]: { api_key: key, model: settings[at]?.model || "" } };
      try {
        const r = await fetch(`${API_BASE}/api/settings`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: body }),
        });
        if (r.ok) {
          setDraftKeys(prev => ({ ...prev, [at]: "" }));
          setSettings(prev => ({
            ...prev,
            [at]: { ...prev[at], api_key: "●●●●" + key.slice(-4), has_key: true },
          }));
        }
      } catch {}
    }

    setSaving(prev => ({ ...prev, [at]: false }));
  };

  const handleSelectModel = async (at: string, modelId: string) => {
    setSettings(prev => ({ ...prev, [at]: { ...prev[at], model: modelId } }));
    fetch(`${API_BASE}/api/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: { [at]: { api_key: "", model: modelId } } }),
    }).catch(() => {});
  };

  if (!open) return null;

  const providerList = ["deepseek", "anthropic", "opencode"];

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <div
        className="relative ml-auto w-[min(464px,65vw)] h-full bg-[var(--bg-primary)] flex flex-col"
        style={{ animation: "slideInRight 0.28s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Header */}
        <div className="flex items-center px-6 h-[48px] border-b border-[var(--border)] shrink-0">
          <button
            onClick={onClose}
            className="w-8 h-8 -ml-2 rounded-full flex items-center justify-center hover:bg-[var(--bg-secondary)] transition-colors text-[var(--text-secondary)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h2 className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)] ml-1">设置</h2>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-[100px] rounded-lg bg-[var(--bg-secondary)] animate-skeleton" />
              ))}
            </div>
          ) : (
            <div className="px-3 py-3 space-y-2">
              {providerList.map(at => {
                const cat = catalog[at];
                const prov = settings[at];
                const hasKey = prov?.has_key;
                const tr = testResult[at];

                return (
                  <div key={at} className="rounded-lg bg-[var(--bg-secondary)] overflow-hidden">
                    {/* Provider header */}
                    <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
                      <div className={cn("w-2 h-2 rounded-full shrink-0", DOT[at])} />
                      <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {at === "deepseek" ? "DeepSeek" : at === "anthropic" ? "Anthropic" : "OpenCode"}
                      </span>
                      {hasKey && <div className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" title="已配置" />}
                    </div>

                    {/* API Key input */}
                    <div className="px-4 pb-2">
                      <div className="flex items-center bg-[var(--bg-primary)] rounded-md border border-[var(--border)]/60 focus-within:border-[var(--accent)]/30 transition-all">
                        <input
                          type={showKeys[at] ? "text" : "password"}
                          value={draftKeys[at] ?? ""}
                          onChange={e => setDraftKeys(prev => ({ ...prev, [at]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") handleSaveProvider(at); }}
                          placeholder={hasKey ? (prov?.api_key || "已配置") : "粘贴 API Key…"}
                          className="flex-1 min-w-0 px-3 py-2 bg-transparent border-0 outline-none text-[12px] placeholder:text-[var(--text-tertiary)] font-mono"
                          autoComplete="off" spellCheck={false}
                        />
                        <button
                          onClick={() => setShowKeys(prev => ({ ...prev, [at]: !prev[at] }))}
                          className={cn("w-7 h-7 flex items-center justify-center shrink-0 transition-colors",
                            showKeys[at] ? "text-[var(--accent)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {showKeys[at] ? (
                              <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></>
                            ) : (
                              <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                            )}
                          </svg>
                        </button>
                        <button
                          onClick={() => handleSaveProvider(at)}
                          disabled={saving[at] || !draftKeys[at]}
                          className="h-7 px-3 rounded-r text-[11px] font-semibold tracking-wide bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:bg-transparent disabled:text-[var(--text-tertiary)] transition-colors shrink-0"
                        >
                          {saving[at] ? "测试中…" : "保存并测试"}
                        </button>
                      </div>
                      {/* 测试结果反馈 */}
                      {tr && (
                        <div className={cn(
                          "mt-1.5 text-[11px] px-2 py-1 rounded",
                          tr.ok
                            ? "bg-[var(--success)]/8 text-[var(--success)]"
                            : "bg-[var(--danger)]/8 text-[var(--danger)]",
                        )}>
                          {tr.ok
                            ? `连接成功 · ${tr.latency_ms}ms`
                            : `连接失败${tr.error ? ` · ${tr.error}` : ""}`
                          }
                        </div>
                      )}
                    </div>

                    {/* Model selector */}
                    {cat?.models && (
                      <div className="px-4 pb-3">
                        <div className="flex gap-1">
                          {cat.models.map(mv => (
                            <button
                              key={mv.id}
                              onClick={() => handleSelectModel(at, mv.id)}
                              className={cn(
                                "flex-1 text-center px-2 py-1.5 rounded text-[11px] font-medium transition-all",
                                prov?.model === mv.id
                                  ? "bg-[var(--bg-primary)] text-[var(--accent)] shadow-sm"
                                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                              )}
                            >
                              {mv.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <p className="text-[10px] text-[var(--text-tertiary)] text-center pt-3">
                API Key 经 AES-256-GCM 加密存储
              </p>
            </div>
          )}
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
