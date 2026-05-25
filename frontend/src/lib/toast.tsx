"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ──

export type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (msg: string) => void;
  error: (msg: string) => void;
  warning: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

let _id = 0;

// ── Config ──

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

const COLORS: Record<ToastType, string> = {
  success: "bg-[#34C759]/95",
  error:   "bg-[#FF3B30]/95",
  warning: "bg-[#FF9F0A]/95",
  info:    "bg-[#007AFF]/95",
};

// ── Provider ──

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++_id;
    setToasts(prev => [...prev.slice(-2), { id, type, message }]); // max 3 in queue
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const ctx: ToastContextValue = {
    success: useCallback((m: string) => add("success", m), [add]),
    error:   useCallback((m: string) => add("error", m), [add]),
    warning: useCallback((m: string) => add("warning", m), [add]),
    info:    useCallback((m: string) => add("info", m), [add]),
  };

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      {/* Toast container — fixed bottom-right */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 pointer-events-none" aria-live="polite">
        <AnimatePresence mode="popLayout">
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
              className={`${COLORS[t.type]} text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg backdrop-blur-sm flex items-center gap-2 max-w-[320px] pointer-events-auto`}
            >
              <span className="text-[15px] font-medium shrink-0">{ICONS[t.type]}</span>
              <span className="truncate">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
