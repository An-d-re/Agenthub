// Agent 类型定制 SVG 图标 — 替代 emoji
import type React from "react";

interface Props {
  adapterType: string;
  size?: number;
  className?: string;
}

export function AgentIcon({ adapterType, size = 18, className }: Props) {
  const style: React.CSSProperties = { width: size, height: size };
  const svg = (d: React.ReactNode) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
    >
      {d}
    </svg>
  );

  switch (adapterType) {
    // DeepSeek — 神经网络节点
    case "deepseek":
      return svg(
        <>
          <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="17" cy="7" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="7" cy="17" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="17" cy="17" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <line x1="7" y1="7" x2="12" y2="12" />
          <line x1="17" y1="7" x2="12" y2="12" />
          <line x1="7" y1="17" x2="12" y2="12" />
          <line x1="17" y1="17" x2="12" y2="12" />
        </>,
      );

    // Anthropic — 星形/光芒
    case "anthropic":
      return svg(
        <>
          <path d="M12 2l1.5 6.5L20 5l-3.5 6.5L22 12l-5.5 0.5L20 19l-6.5-3.5L12 22l-1.5-6.5L4 19l3.5-6.5L2 12l5.5-0.5L4 5l6.5 3.5z" />
        </>,
      );

    // OpenCode — 代码括号 + 齿轮
    case "opencode":
      return svg(
        <>
          <polyline points="16 4 22 12 16 20" />
          <polyline points="8 4 2 12 8 20" />
          <circle cx="12" cy="12" r="2" />
        </>,
      );

    // Codex — 立方体
    case "codex":
      return svg(
        <>
          <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
          <path d="M12 22v-11" />
          <path d="M20 6.5l-8 4.5" />
          <path d="M4 6.5l8 4.5" />
        </>,
      );

    // Default — 几何菱形
    default:
      return svg(
        <>
          <rect x="3" y="3" width="18" height="18" rx="3" transform="rotate(45 12 12)" />
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </>,
      );
  }
}

// 用于头像内的小尺寸图标（16px）
export function AgentAvatarIcon({ adapterType, size = 16 }: { adapterType: string; size?: number }) {
  return <AgentIcon adapterType={adapterType} size={size} />;
}

// 用于自定义 Agent 无头像时的占位图标
export function AgentPlaceholderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size }}
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}
