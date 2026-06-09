"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Agent = {
  name: string;
  role: string;
  color: string;
  message: string;
  delay: number;
};

const AGENTS: Agent[] = [
  {
    name: "Orchestrator",
    role: "协调者",
    color: "#B8956A",
    message: "分析需求中…识别到需要前端实现 + 代码审查 + 部署预览，我将协调 3 位 Agent 并行工作",
    delay: 0.8,
  },
  {
    name: "Coder",
    role: "工程师",
    color: "#5B8C7A",
    message: "正在编写 HTML/CSS/JS，生成响应式倒计时组件，含开始/暂停/重置交互逻辑",
    delay: 2.0,
  },
  {
    name: "Reviewer",
    role: "审查者",
    color: "#7B6F9E",
    message: "代码审查通过：语义化结构 ✓  无障碍访问 ✓  边界情况处理 ✓",
    delay: 3.3,
  },
];

const USER_MESSAGE = "帮我做一个网页倒计时工具";
const USER_DELAY = 0.3;
const RESULT_DELAY = 4.2;

function AgentAvatar({ color, name }: { color: string; name: string }) {
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {name[0]}
    </div>
  );
}

function ChatBubble({
  sender,
  content,
  avatar,
  isUser,
}: {
  sender?: string;
  content: string;
  avatar?: React.ReactNode;
  isUser?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, x: isUser ? 8 : -8 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
      className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && avatar}
      <div className="flex flex-col gap-0.5 max-w-[85%]">
        {sender && (
          <span className="text-[10px] text-white/40 px-1">{sender}</span>
        )}
        <div
          className={`px-2.5 py-1.5 rounded-2xl text-[11px] leading-relaxed ${
            isUser
              ? "bg-white/90 text-[#1a1a1a] rounded-br-md"
              : "bg-white/[0.07] text-white/85 rounded-bl-md"
          }`}
          style={{ wordBreak: "break-word" }}
        >
          {content}
        </div>
      </div>
      {isUser && avatar}
    </motion.div>
  );
}

export function Cover({ onDismiss }: { onDismiss: () => void }) {
  const [phase, setPhase] = useState(0);
  // 0: user typing → 1: user sent → 2: orchestrator → 3: coder → 4: reviewer → 5: result → 6: title + button
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const schedule = [
      { phase: 1, time: USER_DELAY * 1000 + 600 },
      { phase: 2, time: AGENTS[0].delay * 1000 },
      { phase: 3, time: AGENTS[1].delay * 1000 },
      { phase: 4, time: AGENTS[2].delay * 1000 },
      { phase: 5, time: RESULT_DELAY * 1000 },
      { phase: 6, time: RESULT_DELAY * 1000 + 800 },
    ];
    schedule.forEach(({ phase: p, time }) => {
      timerRef.current = setTimeout(() => setPhase(p), time);
    });
    return () => {
      schedule.forEach(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
      });
    };
  }, []);

  const handleClick = () => setExiting(true);

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer"
      animate={exiting ? { opacity: 0, scale: 1.02 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={() => { if (exiting) onDismiss(); }}
      onClick={handleClick}
    >
      {/* Background — warm, refined dark with subtle radial glow */}
      <div className="absolute inset-0" style={{ background: "#141210" }} />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 35%, rgba(184,149,106,0.10) 0%, transparent 70%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(91,140,122,0.06) 0%, transparent 70%)",
        }}
      />
      {/* Subtle grain overlay */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")", backgroundSize: "200px 200px" }} />

      {/* Main layout: chat window center, title below */}
      <div className="relative z-10 flex flex-col items-center gap-8 select-none">
        {/* Chat window mockup */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-[400px] rounded-2xl overflow-hidden"
          style={{
            background: "rgba(28,26,24,0.85)",
            backdropFilter: "blur(40px) saturate(120%)",
            WebkitBackdropFilter: "blur(40px) saturate(120%)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.03), 0 24px 64px rgba(0,0,0,0.4)",
          }}
        >
          {/* Chat header bar */}
          <div
            className="flex items-center gap-2.5 px-4 py-3"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, #B8956A, #D4A574)" }}>
              #
            </div>
            <div>
              <div className="text-[13px] font-semibold text-white/90 leading-tight">
                Demo
              </div>
              <div className="text-[10px] text-white/35">群聊 · 4 人</div>
            </div>
            <div className="ml-auto flex gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
              <span className="text-[10px] text-white/30">在线</span>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex flex-col gap-2.5 px-4 py-4 min-h-[260px]">
            {/* System hint */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: phase >= 1 ? 1 : 0 }}
              className="text-[10px] text-white/25 text-center"
            >
              Orchestrator 正在协调多位 Agent 协作
            </motion.div>

            {/* User message */}
            {phase >= 1 && (
              <>
                <ChatBubble
                  isUser
                  content={USER_MESSAGE}
                  avatar={
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] shrink-0">
                      U
                    </div>
                  }
                />
                {/* Orchestrator typing indicator → message */}
                {phase === 1 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex gap-2 items-center px-1"
                  >
                    <AgentAvatar color={AGENTS[0].color} name={AGENTS[0].name} />
                    <div className="flex gap-1">
                      {[0, 1, 2].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-white/30"
                          animate={{ opacity: [0.2, 0.7, 0.2] }}
                          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </>
            )}

            {/* Agent messages */}
            {AGENTS.map((agent, idx) =>
              phase >= idx + 2 ? (
                <ChatBubble
                  key={agent.name}
                  sender={agent.name}
                  content={agent.message}
                  avatar={<AgentAvatar color={agent.color} name={agent.name} />}
                />
              ) : null
            )}

            {/* Result card */}
            {phase >= 5 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="mx-1 mt-1 rounded-xl overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {/* Preview header */}
                <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#FF5F57]" />
                    <div className="w-2 h-2 rounded-full bg-[#FFBD2E]" />
                    <div className="w-2 h-2 rounded-full bg-[#28C840]" />
                  </div>
                  <span className="text-[10px] text-white/25 ml-2">countdown.html</span>
                </div>
                {/* Preview content */}
                <div className="flex items-center justify-center py-5">
                  <div className="text-center">
                    <div className="text-[28px] font-mono font-bold text-white/80 tracking-wider">
                      24:59
                    </div>
                    <div className="flex gap-2 mt-2.5 justify-center">
                      <div className="px-3 py-1 rounded-full text-[10px] font-medium text-white/70" style={{ background: "rgba(255,255,255,0.08)" }}>
                        开始
                      </div>
                      <div className="px-3 py-1 rounded-full text-[10px] font-medium text-white/70" style={{ background: "rgba(255,255,255,0.08)" }}>
                        暂停
                      </div>
                      <div className="px-3 py-1 rounded-full text-[10px] font-medium text-white/70" style={{ background: "rgba(255,255,255,0.08)" }}>
                        重置
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Title + subtitle fade in */}
        <AnimatePresence>
          {phase >= 6 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
              className="text-center"
            >
              <h1
                className="text-[52px] font-extrabold tracking-tight text-white mb-1.5"
                style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif" }}
              >
                AgentHub
              </h1>
              <p className="text-[15px] text-white/45 font-medium tracking-wide">
                多 Agent 协作平台
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* CTA button */}
        <AnimatePresence>
          {phase >= 6 && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              onClick={handleClick}
              className="px-10 py-3 rounded-full text-[15px] font-semibold tracking-wide transition-all duration-200"
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.9)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.18)";
                e.currentTarget.style.transform = "scale(1.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              开始使用
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
