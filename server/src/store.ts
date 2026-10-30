import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { bulutliTexnologiyalarQuestions } from "./bulutli-texnologiyalar.js";

export type Question = { text: string; options: string[]; correct: number; time: number };
export type Quiz = {
  id: string; ownerId: string; title: string; description: string; category: string;
  isPublic: boolean; questions: Question[]; plays: number; createdAt: number;
};
export type User = {
  id: string; tgId: number | null; name: string; username: string; avatar: string;
  xp: number; games: number; wins: number; podiums: [number, number, number];
  bestScore: number; totalScore: number; createdAt: number; lastSeen: number;
};
type DB = { users: Record<string, User>; quizzes: Record<string, Quiz>; secret: string };

const DB_URL = process.env.DATABASE_URL || "";
let pool: any = null;
/** DATABASE_URL (masalan Neon bepul Postgres) bo'lsa, ma'lumotlar shu yerda saqlanadi; bo'lmasa fayl ishlatiladi. */
export async function initStore() {
  if (!DB_URL) { console.log("DATABASE_URL yo'q: ma'lumotlar faylga yoziladi (Render bepul rejasida o'chib ketadi)."); return; }
  try {
    const name = "pg"; const mod: any = await import(name);
    const Pool = (mod.default || mod).Pool;
    const p = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 3 });
    await p.query("create table if not exists kv (key text primary key, value jsonb not null, updated_at timestamptz default now())");
    const r = await p.query("select value from kv where key = 'db'");
    if (r.rows[0]) db = { ...db, ...r.rows[0].value };
    pool = p;
    console.log("Ma'lumotlar bazasi (Postgres) ulandi.");
  } catch (e: any) {
    pool = null;
    console.error("⚠️ BAZAGA ULANIB BO'LMADI:", e?.code || "", e?.message || e, "— vaqtincha faylga yoziladi. DATABASE_URL va 'pg' paketini tekshiring.");
  }
}

const DATA_DIR = process.env.DATA_DIR || resolve(process.cwd(), "data");
const FILE = resolve(DATA_DIR, "db.json");
let db: DB = { users: {}, quizzes: {}, secret: randomBytes(32).toString("hex") };
if (existsSync(FILE)) {
  try { db = { ...db, ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch (e) { console.error("DB o'qilmadi:", e); }
}
let timer: NodeJS.Timeout | null = null;
function flush(): Promise<void> | void {
  if (pool) {
    return pool.query("insert into kv(key, value) values ('db', $1) on conflict (key) do update set value = excluded.value, updated_at = now()", [JSON.stringify(db)])
      .then(() => undefined).catch((e: unknown) => console.error("DB yozilmadi:", e));
  }
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(db));
  renameSync(tmp, FILE);
}
export function save() { if (timer) return; timer = setTimeout(() => { timer = null; try { flush(); } catch (e) { console.error(e); } }, 400); }
export async function flushNow() { try { await flush(); } catch { /* e'tiborsiz */ } }
export const sessionSecret = () => process.env.SESSION_SECRET || db.secret;
export const uid = () => randomBytes(6).toString("hex");

export const users = () => db.users;
export const quizzes = () => db.quizzes;
export function userByTg(tgId: number) { return Object.values(db.users).find(u => u.tgId === tgId); }
export function newUser(p: Partial<User>): User {
  const u: User = {
    id: uid(), tgId: null, name: "O‘yinchi", username: "", avatar: "fox", xp: 0, games: 0, wins: 0,
    podiums: [0, 0, 0], bestScore: 0, totalScore: 0, createdAt: Date.now(), lastSeen: Date.now(), ...p
  };
  db.users[u.id] = u; save(); return u;
}
export const level = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;
export function publicUser(u: User) {
  return { id: u.id, name: u.name, username: u.username, avatar: u.avatar, xp: u.xp, level: level(u.xp),
    games: u.games, wins: u.wins, podiums: u.podiums, bestScore: u.bestScore, totalScore: u.totalScore };
}
export function seedQuizzes() {
  // Faqat Bulutli texnologiyalar bo'limi qoldiriladi. Mavjud shu bo'lim testlari
  // saqlanadi; server har ishga tushganda foydalanuvchi testlari qayta yozilmaydi.
  let changed = false;
  for (const [id, quiz] of Object.entries(db.quizzes)) {
    if (quiz.category !== "Bulutli texnologiyalar") {
      delete db.quizzes[id];
      changed = true;
    }
  }
  const id = "bulutli-texnologiyalar-oraliq-2";
  if (!db.quizzes[id]) {
    db.quizzes[id] = {
      id, ownerId: "system", title: "Bulutli texnologiyalar — Oraliq test 2",
      description: "Bulutli texnologiyalar bo‘yicha 200 ta savol. Har savolda 4 ta variant.",
      category: "Bulutli texnologiyalar", isPublic: true, plays: 0, createdAt: Date.now(),
      questions: bulutliTexnologiyalarQuestions
    };
    changed = true;
  }
  if (changed) save();
}
