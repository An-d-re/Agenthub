"use client";

import { useState } from "react";

export function Cover({ onDismiss }: { onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);

  const handleClick = () => {
    setExiting(true);
  };

  return (
    <div
      className={`cover-container fixed inset-0 z-[9999] flex items-center justify-center ${exiting ? "exiting" : ""}`}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      {/* 品牌渐变呼吸背景 */}
      <div className="animate-cover-breathe absolute inset-0 bg-gradient-to-br from-[#007AFF] via-[#5856D6] to-[#007AFF] opacity-90" />

      {/* 毛玻璃层 — 聚焦穿透的核心 */}
      <div
        className="cover-glass-pane absolute inset-0"
        style={{
          backdropFilter: "blur(30px) saturate(120%)",
          WebkitBackdropFilter: "blur(30px) saturate(120%)",
          background: "rgba(255,255,255,0.06)",
        }}
      />

      {/* 内容 */}
      <div className="cover-content relative z-10 text-center text-white select-none">
        <h1 className="text-[56px] font-extrabold tracking-tight mb-3"
          style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif" }}>
          AgentHub
        </h1>
        <p className="text-[18px] opacity-80 mb-10 font-medium tracking-wide">
          多 Agent 协作平台
        </p>
        <button
          onClick={handleClick}
          className="px-10 py-3.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30
                     text-[16px] font-semibold tracking-wide
                     hover:bg-white/30 hover:scale-105 active:scale-95
                     transition-all duration-200
                     shadow-[0_0_40px_rgba(255,255,255,0.15)]"
        >
          开始使用
        </button>
      </div>
    </div>
  );
}
