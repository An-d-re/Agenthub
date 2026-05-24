"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizablePanelProps {
  /** Panel width in pixels */
  width: number;
  /** Min width constraint */
  minWidth?: number;
  /** Max width constraint */
  maxWidth?: number;
  /** Called when user drags to resize */
  onWidthChange: (width: number) => void;
  /** Which side the handle is on */
  handleSide?: "left" | "right";
  children: React.ReactNode;
  className?: string;
}

/**
 * Apple-style resizable panel with a subtle drag handle.
 * The handle appears as a thin line that expands on hover.
 */
export function ResizablePanel({
  width,
  minWidth = 200,
  maxWidth = 480,
  onWidthChange,
  handleSide = "right",
  children,
  className,
}: ResizablePanelProps) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const [hovering, setHovering] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.pointerEvents = "none";
    },
    [width]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;

      const delta = handleSide === "right"
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX;

      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
      onWidthChange(newWidth);
    };

    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.pointerEvents = "";
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [handleSide, maxWidth, minWidth, onWidthChange]);

  const handlePosition = handleSide === "right" ? "right-0" : "left-0";
  const handleCursor = handleSide === "right" ? "right-1" : "left-1";

  return (
    <div className={cn("relative shrink-0", className)} style={{ width }}>
      {children}
      {/* 拖拽手柄 */}
      <div
        className={cn(
          "absolute top-0 bottom-0 z-20 group",
          handlePosition
        )}
        style={{ width: 6, marginRight: handleSide === "right" ? -3 : 0, marginLeft: handleSide === "left" ? -3 : 0 }}
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {/* 光标捕获区 */}
        <div
          className={cn(
            "absolute top-0 bottom-0 w-1 transition-all duration-200",
            handleSide === "right" ? "right-0" : "left-0",
            hovering || draggingRef.current
              ? "bg-orange-500/60 scale-x-[3]"
              : "bg-border/50"
          )}
        />
        {/* 拖拽热区（增大点击区域） */}
        <div className="absolute inset-y-0 -inset-x-1 cursor-col-resize" />
      </div>
    </div>
  );
}

/**
 * A simple vertical split handle.
 */
interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  className?: string;
}

export function ResizeHandle({ onMouseDown, className }: ResizeHandleProps) {
  return (
    <div
      className={cn(
        "group relative w-1.5 shrink-0 cursor-col-resize hover:bg-orange-500/30 transition-colors duration-200",
        className
      )}
      onMouseDown={onMouseDown}
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/50 group-hover:bg-orange-500/40 transition-colors duration-200" />
      <div className="absolute inset-y-0 -inset-x-2" />
    </div>
  );
}
