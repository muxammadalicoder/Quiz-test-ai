import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

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
  if (!DB_URL) return;
  const name = "pg"; const mod: any = await import(name);
  const Pool = (mod.default || mod).Pool;
  pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 3 });
  await pool.query("create table if not exists kv (key text primary key, value jsonb not null, updated_at timestamptz default now())");
  const r = await pool.query("select value from kv where key = 'db'");
  if (r.rows[0]) db = { ...db, ...r.rows[0].value };
  console.log("Ma'lumotlar bazasi (Postgres) ulandi.");
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
  // Yangi tayyor testlar qo'shilganda bazani o'chirmasdan, nomi yo'q bo'lganlarini qo'shadi
  const mk = (title: string, category: string, description: string, qs: [string, string[], number][]) => {
    if (Object.values(db.quizzes).some(q => q.ownerId === "system" && q.title === title)) return;
    const id = uid();
    db.quizzes[id] = { id, ownerId: "system", title, description, category, isPublic: true, plays: 0, createdAt: Date.now(),
      questions: qs.map(([text, options, correct]) => ({ text, options, correct, time: 20 })) };
  };
  mk("Umumiy bilimlar", "Umumiy", "Har kim uchun qiziqarli savollar", [
    ["Quyosh tizimidagi eng katta sayyora qaysi?", ["Yer", "Yupiter", "Mars", "Venera"], 1],
    ["O‘zbekiston poytaxti qaysi shahar?", ["Samarqand", "Buxoro", "Andijon", "Toshkent"], 3],
    ["Suvning kimyoviy formulasi qaysi?", ["CO₂", "H₂O", "O₂", "NaCl"], 1],
    ["Bir kilometr necha metr?", ["100", "500", "1000", "10 000"], 2],
    ["Yerning tabiiy yo‘ldoshi nima?", ["Quyosh", "Oy", "Mars", "Yulduz"], 1],
    ["Bir haftada necha soat bor?", ["148", "168", "178", "160"], 1]]);
  mk("Texnologiya va IT", "Texnologiya", "Dasturlash va kompyuter asoslari", [
    ["JavaScript qaysi turdagi til?", ["Faqat database", "Dasturlash tili", "Operatsion tizim", "Brauzer"], 1],
    ["HTML asosan nima uchun ishlatiladi?", ["Veb sahifa tuzilishi", "Serverni sovitish", "Rasm chizish", "Internet tezligini oshirish"], 0],
    ["CPU nimaning qisqartmasi?", ["Central Processing Unit", "Computer Personal Unit", "Core Power Update", "Central Program User"], 0],
    ["Qaysi biri brauzer emas?", ["Chrome", "Firefox", "Linux", "Safari"], 2]]);
  save();
}
