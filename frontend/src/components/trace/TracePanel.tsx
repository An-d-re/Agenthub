"use client";

import { useEffect, useState } from "react";
import { useChatStore, type TraceSpan } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";

const SERVICE_COLORS: Record<string, string> = {
  deepseek: "#22c55e",
  anthropic: "#a855f7",
  opencode: "#3b82f6",
  orchestrator: "#f59e0b",
  agenthub: "#6b7280",
};

function msLabel(ms: number) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TracePanel() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const [spans, setSpans] = useState<TraceSpan[]>([]);

  useEffect(() => {
    if (!activeSessionId) {
      setSpans([]);
      return;
    }
    let cancelled = false;
    const fetchTraces = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/traces?session_id=${activeSessionId}&limit=50`);
        if (res.ok && !cancelled) {
          setSpans(await res.json());
        }
      } catch (e) { console.error("获取追踪数据失败:", e); }
    };
    fetchTraces();
    const interval = setInterval(fetchTraces, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeSessionId]);

  if (!activeSessionId || spans.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-muted-foreground text-center px-4">
          暂无追踪数据
          <br />
          执行任务后查看调用耗时
        </div>
      </div>
    );
  }

  const traces = new Map<string, TraceSpan[]>();
  for (const s of spans) {
    const list = traces.get(s.trace_id) || [];
    list.push(s);
    traces.set(s.trace_id, list);
  }

  const maxDuration = Math.max(...spans.map((s) => s.duration_ms || 0), 1);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          调用追踪
        </h3>
        <div className="text-[10px] text-muted-foreground mt-1">
          {spans.length} 个跨度 · {traces.size} 条链路
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {Array.from(traces.entries()).map(([traceId, traceSpans]) => (
          <div key={traceId} className="border-b border-border/50">
            <div className="px-4 py-2 flex items-center justify-between bg-muted/30">
              <span className="text-[10px] font-mono text-muted-foreground">
                {traceId.slice(0, 8)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {traceSpans.length} spans
              </span>
            </div>

            {traceSpans.map((span) => {
              const pct = ((span.duration_ms || 0) / maxDuration) * 100;
              const color = SERVICE_COLORS[span.service_name] || "#6b7280";
              const isError = span.status === "error";

              return (
                <div
                  key={span.span_id}
                  className="px-4 py-1.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 truncate font-mono">
                      {span.operation_name}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {msLabel(span.duration_ms || 0)}
                    </span>
                  </div>

                  <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(pct, 0.5)}%`,
                        backgroundColor: isError ? "#ef4444" : color,
                      }}
                    />
                  </div>

                  {span.tags && Object.keys(span.tags).length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {Object.entries(span.tags).slice(0, 3).map(([k, v]) => (
                        <span
                          key={k}
                          className="text-[9px] text-muted-foreground bg-muted px-1 rounded"
                        >
                          {k}: {String(v).slice(0, 30)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
