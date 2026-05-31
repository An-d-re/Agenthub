"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Approach } from "@/stores/chatStore";

interface PlanCardProps {
  approaches: Approach[];
  onSelect: (approach: Approach) => void;
  selected?: string;
}

export function PlanCard({ approaches, onSelect, selected }: PlanCardProps) {
  const [chosen, setChosen] = useState<string | undefined>(selected);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setChosen(selected);
  }, [selected]);

  if (!approaches || approaches.length === 0) return null;

  const handleChoice = (a: Approach) => {
    setChosen(a.name);
    setConfirmed(true);
    onSelect(a);
  };

  return (
    <div className="flex justify-center w-full my-3 animate-spring">
      <div className="w-full max-w-xl space-y-3">
        {!confirmed && (
          <div className="text-[11px] text-muted-foreground/60 dark:text-[var(--text-secondary)]/60 text-center uppercase tracking-widest font-medium">
            方案对比
          </div>
        )}

        {approaches.map((a, i) => {
          const isChosen = chosen === a.name;
          if (confirmed && !isChosen) return null; // 选择后只保留已选卡片
          return (
            <div
              key={a.name || i}
              onClick={() => handleChoice(a)}
              className={cn(
                "rounded-2xl border p-4 transition-all duration-300",
                !confirmed && "cursor-pointer hover:border-accent/30",
                isChosen
                  ? "border-accent bg-accent/[0.06] dark:bg-accent/[0.12] shadow-sm shadow-accent/10"
                  : "border-border bg-white/[0.01] dark:bg-[var(--bg-secondary)]",
              )}
            >
              {confirmed && isChosen && (
                <div className="text-[10px] font-medium text-accent uppercase tracking-wider mb-1">已选方案</div>
              )}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-medium dark:text-[var(--bg-secondary)]">{a.name}</span>
                <div className="flex items-center gap-2">
                  {a.recommended && (
                    <span className="text-[10px] font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                      推荐
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {i + 1}/{approaches.length}
                  </span>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground/80 leading-relaxed mb-3">
                {a.summary}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {a.pros.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-accent uppercase tracking-wider mb-1">优点</div>
                    {a.pros.map((p, j) => (
                      <div key={j} className="text-[11px] text-muted-foreground flex gap-1.5">
                        <span className="text-accent shrink-0">+</span> {p}
                      </div>
                    ))}
                  </div>
                )}
                {a.cons.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-destructive uppercase tracking-wider mb-1">缺点</div>
                    {a.cons.map((c, j) => (
                      <div key={j} className="text-[11px] text-muted-foreground flex gap-1.5">
                        <span className="text-destructive shrink-0">-</span> {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!confirmed && (
          <div className="flex justify-center gap-2 pt-1">
            {approaches.map((a, i) => (
              <Button
                key={`btn-${a.name || i}`}
                variant={chosen === a.name ? "default" : "outline"}
                size="sm"
                className="text-[12px] h-8 rounded-full px-4"
                onClick={(e) => { e.stopPropagation(); handleChoice(a); }}
              >
                {chosen === a.name ? "✓ 已选择" : `选择方案 ${i + 1}`}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
