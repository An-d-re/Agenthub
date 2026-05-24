"use client";

import { useEffect, useState } from "react";
import { useChatStore, type TraceSpan } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";

const COLORS: Record<string, string> = {
  deepseek: "#34C759", anthropic: "#AF52DE", opencode: "#007AFF",
  orchestrator: "#FF9F0A", agenthub: "#86868B",
};

function ms(n: number) { return n < 1000 ? `${n.toFixed(0)}ms` : `${(n / 1000).toFixed(1)}s`; }

export function TracePanel() {
  const sid = useChatStore(s => s.activeSessionId);
  const [spans, setSpans] = useState<TraceSpan[]>([]);

  useEffect(() => {
    if (!sid) { setSpans([]); return; }
    let c = false;
    const f = async () => {
      try { const r = await fetch(`${API_BASE}/api/traces?session_id=${sid}&limit=50`);
        if (r.ok && !c) setSpans(await r.json()); } catch {}
    };
    f(); const i = setInterval(f, 5000);
    return () => { c = true; clearInterval(i); };
  }, [sid]);

  if (!sid || spans.length === 0) return (
    <div className="flex items-center justify-center h-full text-[13px] text-[#C7C7CC] text-center px-4">暂无追踪数据<br/><span className="text-[11px]">执行任务后查看</span></div>
  );

  const traces = new Map<string, TraceSpan[]>();
  for (const s of spans) { const l = traces.get(s.trace_id) || []; l.push(s); traces.set(s.trace_id, l); }
  const max = Math.max(...spans.map(s => s.duration_ms || 0), 1);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#86868B]">调用追踪</h3></div>
      <div className="flex-1 overflow-y-auto">
        {Array.from(traces.entries()).map(([tid, tSpans]) => (
          <div key={tid} className="border-t border-[#E5E5E7] first:border-t-0">
            <div className="px-4 py-1.5 flex justify-between bg-[#F9F9FB]"><span className="text-[10px] font-mono text-[#86868B]">{tid.slice(0,8)}</span><span className="text-[10px] text-[#C7C7CC]">{tSpans.length} spans</span></div>
            {tSpans.map(s => {
              const pct = ((s.duration_ms||0)/max)*100;
              const color = COLORS[s.service_name] || "#86868B";
              return (
                <div key={s.span_id} className="px-4 py-1.5 hover:bg-[#F9F9FB] transition-colors">
                  <div className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor:color}}/><span className="flex-1 truncate font-mono">{s.operation_name}</span><span className="text-[#C7C7CC] tabular-nums">{ms(s.duration_ms||0)}</span></div>
                  <div className="mt-1 h-1 bg-[#F5F5F7] rounded-full overflow-hidden"><div className="h-full rounded-full transition-all" style={{width:`${Math.max(pct,0.5)}%`,backgroundColor:s.status==="error"?"#FF3B30":color}}/></div>
                  {s.tags && Object.keys(s.tags).length>0 && <div className="flex gap-1 mt-1">{Object.entries(s.tags).slice(0,3).map(([k,v])=><span key={k} className="text-[9px] text-[#86868B] bg-[#F5F5F7] px-1 rounded">{k}:{String(v).slice(0,30)}</span>)}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
