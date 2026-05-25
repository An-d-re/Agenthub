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

  useEffect(() => {
    setChosen(selected);
  }, [selected]);

  if (!approaches || approaches.length === 0) return null;

  return (
    <div className="flex justify-center w-full my-3 animate-spring">
      <div className="w-full max-w-xl space-y-3">
        <div className="text-[11px] text-muted-foreground/60 dark:text-[#98989D]/60 text-center uppercase tracking-widest font-medium">
          方案对比
        </div>

        {approaches.map((a, i) => {
          const isChosen = chosen === a.name;
          return (
            <div
              key={i}
              onClick={() => { setChosen(a.name); onSelect(a); }}
              className={cn(
                "rounded-2xl border p-4 cursor-pointer transition-all duration-200",
                "hover:border-accent/30",
                isChosen
                  ? "border-accent bg-accent/[0.06] dark:bg-accent/[0.12] shadow-sm shadow-accent/10"
                  : "border-border dark:border-[#38383A] bg-white/[0.01] dark:bg-[#2C2C2E]"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-medium dark:text-[#F5F5F7]">{a.name}</span>
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

        <div className="flex justify-center gap-2 pt-1">
          {approaches.map((a, i) => (
            <Button
              key={i}
              variant={chosen === a.name ? "default" : "outline"}
              size="sm"
              className="text-[12px] h-8 rounded-full px-4"
              onClick={(e) => { e.stopPropagation(); setChosen(a.name); onSelect(a); }}
            >
              {chosen === a.name ? "✓ 已选择" : `选择方案 ${i + 1}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
