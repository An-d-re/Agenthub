/** Stable empty reference to prevent Zustand re-render loops. */
export const EMPTY_ARRAY: never[] = [];

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
