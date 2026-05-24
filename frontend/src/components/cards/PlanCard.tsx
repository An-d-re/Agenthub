"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const handleSelect = (a: Approach) => {
    setChosen(a.name);
    onSelect(a);
  };

  if (!approaches || approaches.length === 0) return null;

  return (
    <div className="flex justify-center w-full my-3 animate-fade-in">
      <div className="w-full max-w-xl space-y-3">
        <div className="text-xs text-muted-foreground text-center tracking-wider uppercase">
          方案对比
        </div>

        {approaches.map((a, i) => {
          const isChosen = chosen === a.name;
          return (
            <Card
              key={i}
              className={cn(
                "border transition-colors duration-200 cursor-pointer hover:border-accent/40",
                isChosen && "border-accent bg-accent/5"
              )}
              onClick={() => handleSelect(a)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium tracking-tight">
                    {a.name}
                  </CardTitle>
                  <div className="flex gap-2 items-center">
                    {a.recommended && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-accent text-accent h-5"
                      >
                        推荐
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {i + 1}/{approaches.length}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {a.summary}
                </p>
                {a.pros.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-accent mb-1">
                      优点
                    </div>
                    <ul className="text-xs space-y-0.5">
                      {a.pros.map((p, j) => (
                        <li key={j} className="text-muted-foreground flex gap-2">
                          <span className="text-accent mt-1 shrink-0">+</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {a.cons.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-destructive mb-1">
                      缺点
                    </div>
                    <ul className="text-xs space-y-0.5">
                      {a.cons.map((c, j) => (
                        <li key={j} className="text-muted-foreground flex gap-2">
                          <span className="text-destructive mt-1 shrink-0">-</span>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <div className="flex justify-center gap-3 pt-1">
          {approaches.map((a, i) => (
            <Button
              key={i}
              variant={chosen === a.name ? "default" : "outline"}
              size="sm"
              className="text-xs h-8 tracking-wide"
              onClick={(e) => {
                e.stopPropagation();
                handleSelect(a);
              }}
            >
              {chosen === a.name ? "✓ 已选择" : `选择方案 ${i + 1}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
