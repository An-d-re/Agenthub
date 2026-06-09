"use client";

import { useMemo, useState } from "react";
import { useChatStore, type TraceSpan } from "@/stores/chatStore";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  deepseek: "#34C759", anthropic: "#AF52DE", opencode: "#007AFF",
  orchestrator: "#FF9F0A", agenthub: "#86868B",
};

function ms(n: number) { return n < 1000 ? `${n.toFixed(0)}ms` : `${(n / 1000).toFixed(1)}s`; }

export function TracePanel() {
  const sid = useChatStore(s => s.activeSessionId);
  const spans = useChatStore(s => sid ? (s.traceSpans[sid] || []) : []);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);

  const { sortedTraces, services } = useMemo(() => {
    const t = new Map<string, TraceSpan[]>();
    const svc = new Set<string>();
    for (const s of spans) {
      const list = t.get(s.trace_id) || [];
      list.push(s);
      t.set(s.trace_id, list);
      svc.add(s.service_name);
    }
    const sorted = Array.from(t.entries())
      .sort(([, a], [, b]) => Math.max(...(b.map(s => s.duration_ms || 0))) - Math.max(...(a.map(s => s.duration_ms || 0))));
    return { traces: t, sortedTraces: sorted, services: Array.from(svc) };
  }, [spans]);

  const filteredTraces = selectedTrace
    ? sortedTraces.filter(([tid]) => tid === selectedTrace)
    : sortedTraces;

  if (!sid || spans.length === 0) return (
    <div className="flex items-center justify-center h-full text-[13px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)] text-center px-4">
      暂无追踪数据<br /><span className="text-[11px]">执行任务后查看</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 shrink-0">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">调用追踪</h3>

        {/* Service filter */}
        <div className="flex gap-1 mt-2 flex-wrap">
          <button onClick={() => setServiceFilter(null)}
            className={cn("text-[10px] px-2 py-0.5 rounded-md transition-colors",
              !serviceFilter ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--border)] dark:hover:bg-[var(--border)]")}>
            全部
          </button>
          {services.map(svc => (
            <button key={svc} onClick={() => setServiceFilter(serviceFilter === svc ? null : svc)}
              className={cn("text-[10px] px-2 py-0.5 rounded-md transition-colors flex items-center gap-1",
                serviceFilter === svc ? "text-white" : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--border)] dark:hover:bg-[var(--border)]")}
              style={serviceFilter === svc ? { backgroundColor: COLORS[svc] || "#86868B" } : {}}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COLORS[svc] || "#86868B" }} />
              {svc}
            </button>
          ))}
        </div>

        {/* Trace selector */}
        {sortedTraces.length > 1 && (
          <select
            value={selectedTrace || ""}
            onChange={e => setSelectedTrace(e.target.value || null)}
            className="mt-2 w-full text-[11px] bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)] border-0 rounded-lg px-2 py-1.5 outline-none"
          >
            <option value="">全部 Trace ({sortedTraces.length})</option>
            {sortedTraces.map(([tid, tSpans]) => (
              <option key={tid} value={tid}>
                {tid.slice(0, 8)} · {tSpans.length} spans · {ms(Math.max(...tSpans.map(s => s.duration_ms || 0)))}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredTraces.map(([tid, tSpans]) => {
          const displaySpans = serviceFilter
            ? tSpans.filter(s => s.service_name === serviceFilter)
            : tSpans;
          const max = Math.max(...displaySpans.map(s => s.duration_ms || 0), 1);
          const traceTotal = displaySpans.reduce((sum, s) => sum + (s.duration_ms || 0), 0);

          return (
            <div key={tid} className="border-t border-[var(--border)] first:border-t-0">
              <div className="px-4 py-1.5 flex justify-between bg-[var(--bg-tertiary)] dark:bg-[var(--bg-secondary)]">
                <span className="text-[10px] font-mono text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{tid.slice(0, 8)}</span>
                <span className="text-[10px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]">{displaySpans.length} spans · {ms(traceTotal)}</span>
              </div>

              {displaySpans.map(s => {
                const pct = ((s.duration_ms || 0) / max) * 100;
                const color = COLORS[s.service_name] || "#86868B";
                const isError = s.status === "error";
                const indent = s.parent_span_id ? 16 : 0;

                return (
                  <div key={s.span_id} className="px-4 py-1.5 hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-secondary)] transition-colors"
                    style={{ paddingLeft: `${16 + indent}px` }}>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 truncate font-mono dark:text-[var(--text-primary)]">{s.operation_name}</span>
                      <span className={cn("tabular-nums", isError ? "text-[var(--danger)]" : "text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]")}>
                        {ms(s.duration_ms || 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-1 bg-[var(--bg-secondary)] dark:bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(pct, 0.5)}%`, backgroundColor: isError ? "#FF3B30" : color }} />
                    </div>
                    {s.tags && Object.keys(s.tags).length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {Object.entries(s.tags).slice(0, 4).map(([k, v]) => (
                          <span key={k} className="text-[9px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] dark:bg-[var(--bg-tertiary)] px-1 rounded">
                            {k}:{String(v).slice(0, 30)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
