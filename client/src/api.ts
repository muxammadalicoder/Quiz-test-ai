import { io, Socket } from "socket.io-client";

const env = (import.meta as any).env || {};
export const SERVER: string = env.VITE_SERVER_URL ||
  (location.hostname === "localhost" && location.port === "5173" ? "http://localhost:3001" : location.origin);

export const tg: any = (window as any).Telegram?.WebApp;
export const inTelegram = !!(tg && tg.initData);

export type User = {
  id: string; name: string; username: string; avatar: string; xp: number; level: number; games: number;
  wins: number; podiums: [number, number, number]; bestScore: number; totalScore: number;
};
export type QuizCard = {
  id: string; title: string; description: string; category: string; isPublic: boolean; count: number;
  plays: number; ownerId: string; owner: string; createdAt: number;
};
export type EQuestion = { text: string; options: string[]; correct: number; time: number };
export type Config = { ai?: boolean; guest: boolean; categories: string[]; reactions: string[]; bot?: string };

const KEY = "quiz-arena-token";
export const getToken = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const setToken = (t: string) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ruxsat yo'q */ } };
let onAuthFail: () => void = () => {};
export const setAuthFailHandler = (f: () => void) => { onAuthFail = f; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(SERVER + path, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(opts.auth === false ? {} : { Authorization: `Bearer ${getToken()}` }) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  } catch { throw new Error("Internetga ulanib bo‘lmadi."); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && opts.auth !== false) onAuthFail();
  if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi.");
  return data as T;
}

export function connectSocket(): Socket {
  return io(SERVER, { auth: { token: getToken() }, transports: ["websocket", "polling"], reconnection: true });
}

export const haptic = (kind: "light" | "success" | "error" | "select" = "light") => {
  try {
    if (kind === "select") tg?.HapticFeedback?.selectionChanged();
    else if (kind === "light") tg?.HapticFeedback?.impactOccurred("light");
    else tg?.HapticFeedback?.notificationOccurred(kind);
  } catch { /* yo'q */ }
};
