import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { makeToken, readToken, verifyInitData } from "./auth.js";
import { startBot } from "./bot.js";
import { aiAllowed, aiEnabled, explain, listenChoice, tts, ttsCached } from "./ai.js";
import { Quiz, Question, User, flushNow, initStore, level, newUser, publicUser, quizzes, save, seedQuizzes, uid, userByTg, users } from "./store.js";

const PORT = Number(process.env.PORT || 3001);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ALLOW_GUEST = process.env.ALLOW_GUEST ? process.env.ALLOW_GUEST === "true" : !BOT_TOKEN;
const ORIGINS = [
  ...(process.env.CLIENT_ORIGIN || "http://localhost:5173").split(","),
  ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
  ...(process.env.WEBAPP_URL ? [process.env.WEBAPP_URL] : [])
].map(o => o.trim().replace(/\/$/, "")).filter(Boolean);
const corsOrigin = (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) =>
  !origin || ORIGINS.includes(origin.replace(/\/$/, "")) ? cb(null, true) : cb(new Error("CORS"));

const AVATARS: Record<string, number> = {
  fox: 1, panda: 1, tiger: 1, frog: 1, unicorn: 1, octopus: 1, monkey: 1, bear: 1, penguin: 1,
  wolf: 2, lion: 2, dragon: 3, ghost: 3, robot: 4, alien: 5, phoenix: 7
};
const REACTIONS = ["🔥", "👏", "😂", "😮", "❤️", "🎉"];
const CATEGORIES = ["Umumiy", "Texnologiya", "Tarix", "Geografiya", "Fan", "Til", "Sport", "Ko‘ngilochar", "Boshqa"];

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Telegram Web iframe ichida ochilishi uchun faqat Telegram domenlariga ruxsat
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' wss: ws: https:; " +
    "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'self'; form-action 'self'");
  next();
});
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));

// ---- Oddiy so'rov cheklovi (IP bo'yicha) ----
const hits = new Map<string, { n: number; t: number }>();
function limit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`; const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); return next(); }
    if (++h.n > max) return res.status(429).json({ error: "Juda ko‘p so‘rov. Biroz kuting." });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 120000) hits.delete(k); }, 60000).unref();

// ---- Yordamchilar ----
const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const cleanName = (v: unknown) => { const s = clean(v, 18); return s.length >= 2 ? s : ""; };
type Authed = Request & { user: User };
function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || "";
  const id = readToken(h.startsWith("Bearer ") ? h.slice(7) : "");
  const u = id ? users()[id] : undefined;
  if (!u) return res.status(401).json({ error: "Qayta kiring." });
  u.lastSeen = Date.now();
  (req as Authed).user = u;
  next();
}
const me = (req: Request) => (req as Authed).user;

function validateQuiz(body: any): { ok: true; data: Pick<Quiz, "title" | "description" | "category" | "isPublic" | "questions"> } | { ok: false; error: string } {
  const title = clean(body?.title, 60), description = clean(body?.description, 140);
  const category = CATEGORIES.includes(body?.category) ? body.category : "Boshqa";
  if (title.length < 3) return { ok: false, error: "Test nomi kamida 3 belgi bo‘lsin." };
  if (!Array.isArray(body?.questions) || body.questions.length < 1 || body.questions.length > 300)
    return { ok: false, error: "Testda 1 tadan 300 tagacha savol bo‘lishi kerak." };
  const questions: Question[] = [];
  for (const [i, q] of body.questions.entries()) {
    const text = clean(q?.text, 200);
    const options = Array.isArray(q?.options) ? q.options.map((o: unknown) => clean(o, 100)).filter(Boolean).slice(0, 4) : [];
    const correct = Number(q?.correct), time = Math.round(Number(q?.time) || 20);
    if (!text) return { ok: false, error: `${i + 1}-savol matni bo‘sh.` };
    if (options.length < 2) return { ok: false, error: `${i + 1}-savolda kamida 2 ta variant bo‘lsin.` };
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) return { ok: false, error: `${i + 1}-savolda to‘g‘ri javob tanlanmagan.` };
    questions.push({ text, options, correct, time: Math.min(60, Math.max(5, time)) });
  }
  return { ok: true, data: { title, description, category, isPublic: body?.isPublic !== false, questions } };
}
const quizCard = (q: Quiz) => ({
  id: q.id, title: q.title, description: q.description, category: q.category, isPublic: q.isPublic,
  count: q.questions.length, plays: q.plays, ownerId: q.ownerId, createdAt: q.createdAt,
  owner: q.ownerId === "system" ? "Quiz Arena" : users()[q.ownerId]?.name || "Noma’lum"
});

// ---- Ochiq yo'llar ----
app.get("/health", (_q, r) => { r.json({ status: "ok" }); });
app.get("/api/config", (_q, r) => { r.json({ ai: aiEnabled, guest: ALLOW_GUEST, categories: CATEGORIES, reactions: REACTIONS, bot: process.env.BOT_USERNAME || "" }); });

app.post("/api/auth/telegram", limit(30, 60000), (req, res) => {
  const tg = verifyInitData(req.body?.initData, BOT_TOKEN);
  if (!tg) return res.status(401).json({ error: "Telegram tasdiqlashi muvaffaqiyatsiz." });
  let u = userByTg(tg.id);
  if (!u) u = newUser({ tgId: tg.id, name: cleanName([tg.first_name, tg.last_name].filter(Boolean).join(" ")) || "O‘yinchi", username: clean(tg.username, 32) });
  u.lastSeen = Date.now(); save();
  res.json({ token: makeToken(u.id), user: publicUser(u) });
});
app.post("/api/auth/guest", limit(10, 60000), (req, res) => {
  if (!ALLOW_GUEST) return res.status(403).json({ error: "Faqat Telegram orqali kirish mumkin." });
  const u = newUser({ name: cleanName(req.body?.name) || "Mehmon" + randomInt(100, 999) });
  res.json({ token: makeToken(u.id), user: publicUser(u) });
});

// ---- Himoyalangan yo'llar ----
app.get("/api/me", auth, (req, res) => { res.json({ user: publicUser(me(req)) }); });
app.patch("/api/me", auth, limit(30, 60000), (req, res) => {
  const u = me(req);
  const name = req.body?.name !== undefined ? cleanName(req.body.name) : u.name;
  if (!name) return res.status(400).json({ error: "Ism kamida 2 belgidan iborat bo‘lsin." });
  let avatar = u.avatar;
  if (req.body?.avatar !== undefined) {
    const a = req.body.avatar;
    if (typeof a !== "string" || !(a in AVATARS)) return res.status(400).json({ error: "Noto‘g‘ri avatar." });
    if (level(u.xp) < AVATARS[a]) return res.status(403).json({ error: `Bu avatar ${AVATARS[a]}-darajada ochiladi.` });
    avatar = a;
  }
  u.name = name; u.avatar = avatar; save();
  res.json({ user: publicUser(u) });
});

app.get("/api/quizzes", auth, (req, res) => {
  const mine = req.query.scope === "mine"; const search = clean(req.query.q, 40).toLowerCase();
  const showMemorize = search.includes("yodlash uchun");
  const list = Object.values(quizzes())
    .filter(q => (mine ? q.ownerId === me(req).id : q.isPublic || q.ownerId === me(req).id))
    .filter(q => showMemorize || !q.title.startsWith("Yodlash uchun — BBL "))
    .filter(q => !search || q.title.toLowerCase().includes(search) || q.category.toLowerCase().includes(search))
    .sort((a, b) => b.plays - a.plays || b.createdAt - a.createdAt).slice(0, req.query.forMemorize === "1" ? 1000 : 100).map(quizCard);
  res.json({ quizzes: list });
});
app.get("/api/quizzes/:id", auth, (req, res) => {
  const q = quizzes()[req.params.id];
  if (!q || (!q.isPublic && q.ownerId !== me(req).id)) return res.status(404).json({ error: "Test topilmadi." });
  res.json({ quiz: q.ownerId === me(req).id ? { ...quizCard(q), questions: q.questions } : quizCard(q) });
});
app.post("/api/quizzes", auth, limit(20, 60000), (req, res) => {
  const v = validateQuiz(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (Object.values(quizzes()).filter(q => q.ownerId === me(req).id).length >= 50) return res.status(400).json({ error: "Eng ko‘pi bilan 50 ta test yaratish mumkin." });
  const q: Quiz = { id: uid(), ownerId: me(req).id, plays: 0, createdAt: Date.now(), ...v.data };
  quizzes()[q.id] = q; save();
  res.json({ quiz: quizCard(q) });
});
app.put("/api/quizzes/:id", auth, limit(30, 60000), (req, res) => {
  const q = quizzes()[req.params.id];
  if (!q || q.ownerId !== me(req).id) return res.status(404).json({ error: "Test topilmadi." });
  const v = validateQuiz(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  Object.assign(q, v.data); save();
  res.json({ quiz: quizCard(q) });
});
// Testni faqat maxsus parol biladigan admin o'chira oladi (parol Render'dagi ADMIN_PASSWORD o'zgaruvchisida)
const sha = (x: string) => createHash("sha256").update(x).digest();
app.delete("/api/quizzes/:id", auth, limit(6, 60000), (req, res) => {
  const adminPass = process.env.ADMIN_PASSWORD || "";
  if (!adminPass) return res.status(503).json({ error: "O‘chirish yoqilmagan: serverda ADMIN_PASSWORD o‘rnatilmagan." });
  const given = typeof req.body?.password === "string" ? req.body.password.slice(0, 100) : "";
  if (!timingSafeEqual(sha(given), sha(adminPass))) return res.status(403).json({ error: "Parol noto‘g‘ri." });
  const q = quizzes()[req.params.id];
  if (!q) return res.status(404).json({ error: "Test topilmadi." });
  delete quizzes()[q.id]; save(); res.json({ ok: true });
});
app.get("/api/leaderboard", auth, (_req, res) => {
  const top = Object.values(users()).filter(u => u.games > 0).sort((a, b) => b.xp - a.xp).slice(0, 50).map(publicUser);
  res.json({ users: top });
});

// ---- Ball hisoblash va statistika ----
const pointsFor = (remainingMs: number, totalMs: number, streak: number) =>
  500 + Math.round(500 * Math.max(0, Math.min(1, remainingMs / totalMs))) + Math.min(streak, 5) * 100;
function award(u: User, score: number, rank: number | null, solo: boolean) {
  u.games += 1; u.totalScore += score; u.bestScore = Math.max(u.bestScore, score);
  u.xp += Math.round(score / (solo ? 25 : 10)) + (solo ? 10 : 25) + (rank === 1 ? 100 : rank === 2 ? 60 : rank === 3 ? 30 : 0);
  if (rank && rank <= 3) { u.podiums[rank - 1] += 1; if (rank === 1) u.wins += 1; }
  save();
}

// ---- Tasodifiy savollar: 20/25/30 ta (yoki hammasi), savollar va variantlar aralashtiriladi ----
const COUNTS = [20, 25, 30];
function shuffle<T>(a: T[]): T[] { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = randomInt(i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; }
function pick(quiz: Quiz, count: unknown, memorize = false, rangeStart?: unknown, rangeEnd?: unknown, shuffleQuestions = false): Quiz {
  let sourceQuestions = memorize ? [...quiz.questions] : (shuffleQuestions ? shuffle(quiz.questions) : [...quiz.questions]);
  if (memorize) {
    const start = Math.max(0, Math.min(sourceQuestions.length, Number.isInteger(Number(rangeStart)) ? Number(rangeStart) : 0));
    const requestedEnd = Number(rangeEnd);
    const end = Number.isInteger(requestedEnd) ? Math.max(start, Math.min(sourceQuestions.length, requestedEnd)) : sourceQuestions.length;
    sourceQuestions = sourceQuestions.slice(start, end);
  }
  const n = COUNTS.includes(Number(count)) ? Number(count) : sourceQuestions.length;
  const qs = sourceQuestions.slice(0, n).map(q => {
    const order = shuffle(q.options.map((_, i) => i));
    return { ...q, options: order.map(i => q.options[i]), correct: order.indexOf(q.correct) };
  });
  return { ...quiz, questions: qs };
}

// ---- Yakka test (javoblar serverda, to'g'ri javob oldindan yuborilmaydi) ----
type Solo = { talk: boolean; log: number[]; userId: string; quiz: Quiz; i: number; score: number; streak: number; correct: number; sentAt: number; answered: boolean; touched: number };
const solos = new Map<string, Solo>();
setInterval(() => { const now = Date.now(); for (const [k, s] of solos) if (now - s.touched > 3600000) solos.delete(k); }, 60000).unref();
const soloReview = (s: Solo) => s.quiz.questions.slice(0, s.log.length).map((q, k) => ({ text: q.text, options: q.options, correct: q.correct, picked: s.log[k] }));
const TALK_EXTRA = 45; // ovozli rejimda savolni o'qib berish uchun qo'shimcha soniyalar
const soloQ = (s: Solo) => {
  const q = s.quiz.questions[s.i]; s.sentAt = Date.now(); s.answered = false;
  return { index: s.i, total: s.quiz.questions.length, text: q.text, options: q.options, time: q.time + (s.talk ? TALK_EXTRA : 0), score: s.score };
};
app.post("/api/solo/start", auth, limit(40, 60000), (req, res) => {
  const quiz = quizzes()[String(req.body?.quizId)];
  if (!quiz || (!quiz.isPublic && quiz.ownerId !== me(req).id)) return res.status(404).json({ error: "Test topilmadi." });
  const sid = uid() + uid();
  const s: Solo = { talk: !!req.body?.talk, log: [], userId: me(req).id, quiz: pick(quiz, req.body?.count, req.body?.memorize === true, req.body?.rangeStart, req.body?.rangeEnd, req.body?.shuffleQuestions === true), i: 0, score: 0, streak: 0, correct: 0, sentAt: 0, answered: false, touched: Date.now() };
  solos.set(sid, s);
  res.json({ sid, title: quiz.title, question: soloQ(s) });
});
app.post("/api/solo/answer", auth, limit(120, 60000), async (req, res) => {
  const s = solos.get(String(req.body?.sid));
  if (!s || s.userId !== me(req).id) return res.status(404).json({ error: "O‘yin topilmadi." });
  if (s.answered) return res.status(409).json({ error: "Bu savolga javob berilgan." });
  const q = s.quiz.questions[s.i]; const idx = req.body?.index;
  const total = (q.time + (s.talk ? TALK_EXTRA : 0)) * 1000, elapsed = Date.now() - s.sentAt;
  s.answered = true; s.touched = Date.now();
  const inTime = elapsed <= total + 1500;
  s.log.push(inTime && Number.isInteger(idx) ? idx : -1);
  const ok = inTime && Number.isInteger(idx) && idx === q.correct;
  let points = 0;
  if (ok) { s.streak += 1; s.correct += 1; points = pointsFor(total - elapsed, total, s.streak - 1); s.score += points; } else s.streak = 0;
  const last = s.i + 1 >= s.quiz.questions.length;
  const out: any = { correct: ok, correctIndex: q.correct, points, score: s.score, streak: s.streak, timedOut: !inTime };
  if (!ok && s.talk && req.body?.explain && aiAllowed(me(req).id)) {
    const e = await explain({ text: q.text, options: q.options, correct: q.correct, picked: inTime && Number.isInteger(idx) ? idx : -1 });
    if (e) out.explanation = e;
  }
  if (last) {
    const u = me(req); const before = level(u.xp);
    award(u, s.score, null, true);
    const live = quizzes()[s.quiz.id]; if (live) { live.plays += 1; save(); }
    solos.delete(String(req.body.sid));
    out.finished = { review: soloReview(s), score: s.score, correct: s.correct, total: s.quiz.questions.length, user: publicUser(u), levelUp: level(u.xp) > before };
  } else { s.i += 1; out.next = true; }
  res.json(out);
});
app.post("/api/solo/finish", auth, (req, res) => {
  const sid = String(req.body?.sid); const s = solos.get(sid);
  if (!s || s.userId !== me(req).id) return res.status(404).json({ error: "O‘yin topilmadi." });
  const answered = s.i + (s.answered ? 1 : 0); const u = me(req); const before = level(u.xp);
  solos.delete(sid);
  if (answered > 0) { award(u, s.score, null, true); const live = quizzes()[s.quiz.id]; if (live) { live.plays += 1; save(); } }
  res.json({ finished: { review: soloReview(s), score: s.score, correct: s.correct, total: s.quiz.questions.length, answered, user: publicUser(u), levelUp: level(u.xp) > before } });
});
const AUDIO_MIMES = ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"];
app.post("/api/ai/tts", auth, limit(40, 60000), async (req, res) => {
  if (!aiEnabled) return res.status(503).json({ error: "AI o‘chiq." });
  const text = clean(req.body?.text, 600);
  if (!text) return res.status(400).json({ error: "Matn bo‘sh." });
  const hit = ttsCached(text); if (hit) return res.json({ audio: hit });
  if (!aiAllowed(me(req).id, "tts")) return res.status(429).json({ error: "Bugungi ovoz limiti tugadi." });
  const audio = await tts(text);
  if (!audio) return res.status(502).json({ error: "Ovoz yaratilmadi." });
  res.json({ audio });
});
app.post("/api/ai/listen", auth, limit(40, 60000), async (req, res) => {
  if (!aiEnabled) return res.status(503).json({ error: "AI o‘chiq." });
  const audio = typeof req.body?.audio === "string" ? req.body.audio : "";
  const mime = String(req.body?.mime || "").split(";")[0].trim().toLowerCase();
  const options = Array.isArray(req.body?.options) ? req.body.options.slice(0, 4).map((o: unknown) => clean(o, 100)) : [];
  if (!audio || audio.length > 900000 || !AUDIO_MIMES.includes(mime) || options.length < 2) return res.status(400).json({ error: "Noto‘g‘ri so‘rov." });
  if (!aiAllowed(me(req).id, "listen")) return res.status(429).json({ error: "Bugungi ovoz tanish limiti tugadi." });
  const out = await listenChoice(audio, mime, options);
  if (!out) return res.status(502).json({ error: "Ovoz tushunilmadi." });
  res.json(out);
});
app.post("/api/solo/next", auth, (req, res) => {
  const s = solos.get(String(req.body?.sid));
  if (!s || s.userId !== me(req).id || !s.answered) return res.status(404).json({ error: "O‘yin topilmadi." });
  res.json({ question: soloQ(s) });
});

// ---- Ommaviy o'yin (Socket.IO) ----
type RPlayer = { picks: Record<number, number>; userId: string; score: number; streak: number; connected: boolean; lastSeen: number; answer?: number; points?: number; correct?: boolean };
type Room = {
  code: string; hostId: string; quiz: Quiz; players: Map<string, RPlayer>; banned: Set<string>;
  status: "lobby" | "question" | "results" | "finished"; i: number; endsAt: number; startedAt: number;
  timer?: NodeJS.Timeout; gained?: Record<string, number>; emptySince?: number;
};
const rooms = new Map<string, Room>();
const server = createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin, methods: ["GET", "POST"] }, maxHttpBufferSize: 16 * 1024, connectTimeout: 20000 });
const MAX_PLAYERS = 50;

function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = "";
  do { c = Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join(""); } while (rooms.has(c));
  return c;
}
const roomOf = (userId: string) => [...rooms.values()].find(r => r.players.has(userId));
function stateFor(r: Room, userId: string) {
  const list = [...r.players.entries()].map(([id, p]) => {
    const u = users()[id];
    return { id, name: u?.name || "?", avatar: u?.avatar || "fox", level: u ? level(u.xp) : 1, score: p.score, streak: p.streak, connected: p.connected,
      answered: p.answer !== undefined, correct: r.status === "results" || r.status === "finished" ? p.correct : undefined, points: r.status === "results" ? p.points : undefined };
  });
  const board = [...list].sort((a, b) => b.score - a.score);
  const q = r.i >= 0 ? r.quiz.questions[r.i] : undefined; const mine = r.players.get(userId);
  const showAns = r.status === "results" || r.status === "finished";
  return {
    code: r.code, hostId: r.hostId, status: r.status, now: Date.now(), endsAt: r.endsAt,
    quiz: { id: r.quiz.id, title: r.quiz.title, category: r.quiz.category, total: r.quiz.questions.length },
    index: r.i, players: list, leaderboard: board,
    question: q && r.status !== "lobby" && r.status !== "finished" ? { text: q.text, options: q.options, time: q.time } : undefined,
    correctIndex: showAns && q && r.status === "results" ? q.correct : undefined,
    counts: r.status === "results" && q ? q.options.map((_, k) => [...r.players.values()].filter(p => p.answer === k).length) : undefined,
    me: mine ? { answer: mine.answer, points: mine.points, correct: mine.correct, answered: mine.answer !== undefined } : undefined,
    gained: r.status === "finished" ? r.gained : undefined,
    review: r.status === "finished" ? r.quiz.questions.slice(0, r.i + 1).map((qq, k) => ({ text: qq.text, options: qq.options, correct: qq.correct, picked: mine?.picks[k] ?? -1 })) : undefined
  };
}
function push(r: Room) { for (const id of r.players.keys()) io.to("u:" + id).emit("room:state", stateFor(r, id)); }
function connectedCount(r: Room) { return [...r.players.values()].filter(p => p.connected).length; }
function reveal(r: Room) {
  if (r.status !== "question") return;
  clearTimeout(r.timer); r.status = "results"; r.endsAt = 0;
  for (const p of r.players.values()) { if (p.answer === undefined) { p.streak = 0; p.points = 0; p.correct = false; } }
  push(r);
}
function ask(r: Room, i: number) {
  r.i = i; const q = r.quiz.questions[i]; r.status = "question";
  for (const p of r.players.values()) { p.answer = undefined; p.points = undefined; p.correct = undefined; }
  r.endsAt = Date.now() + q.time * 1000;
  clearTimeout(r.timer); r.timer = setTimeout(() => reveal(r), q.time * 1000 + 300);
  push(r);
}
function finish(r: Room) {
  r.status = "finished"; r.endsAt = 0; clearTimeout(r.timer); r.gained = {};
  const ranked = [...r.players.entries()].sort((a, b) => b[1].score - a[1].score);
  ranked.forEach(([id, p], k) => {
    const u = users()[id]; if (!u) return; const before = u.xp;
    award(u, p.score, p.score > 0 ? k + 1 : null, false); r.gained![id] = u.xp - before;
  });
  const live = quizzes()[r.quiz.id]; if (live) { live.plays += 1; save(); }
  push(r);
}
function removeFrom(r: Room, userId: string) {
  r.players.delete(userId);
  if (!r.players.size) { clearTimeout(r.timer); rooms.delete(r.code); return; }
  if (r.hostId === userId) r.hostId = [...r.players.entries()].find(([, p]) => p.connected)?.[0] || [...r.players.keys()][0];
  if (r.status === "question" && [...r.players.values()].every(p => p.answer !== undefined || !p.connected)) reveal(r); else push(r);
}
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    for (const [id, p] of r.players) if (!p.connected && now - p.lastSeen > 90000 && r.status === "lobby") removeFrom(r, id);
    if (rooms.has(r.code) && connectedCount(r) === 0) { r.emptySince ??= now; if (now - r.emptySince > 300000) { clearTimeout(r.timer); rooms.delete(r.code); } } else r.emptySince = undefined;
  }
}, 15000).unref();

const online = new Map<string, number>(); let onlineTimer: NodeJS.Timeout | null = null;
function pushOnline() { if (onlineTimer) return; onlineTimer = setTimeout(() => { onlineTimer = null; io.emit("online", online.size); }, 800); }
io.use((socket, next) => {
  const id = readToken(socket.handshake.auth?.token);
  if (!id || !users()[id]) return next(new Error("auth"));
  (socket.data as any).userId = id; next();
});
io.on("connection", (socket: Socket) => {
  const userId: string = (socket.data as any).userId;
  const err = (m: string) => socket.emit("room:error", m);
  let wStart = Date.now(), wCount = 0;
  socket.use((_p, next) => {
    const now = Date.now(); if (now - wStart > 10000) { wStart = now; wCount = 0; }
    if (++wCount > 60) return next(new Error("Juda ko‘p so‘rov.")); next();
  });
  socket.join("u:" + userId);
  online.set(userId, (online.get(userId) || 0) + 1); socket.emit("online", online.size); pushOnline();
  const existing = roomOf(userId);
  if (existing) { const p = existing.players.get(userId)!; p.connected = true; p.lastSeen = Date.now(); existing.emptySince = undefined; push(existing); }
  else socket.emit("room:none");

  socket.on("room:create", (b: any = {}) => {
    if (roomOf(userId)) return err("Siz allaqachon xonadasiz.");
    const quiz = quizzes()[String(b.quizId)];
    if (!quiz || (!quiz.isPublic && quiz.ownerId !== userId)) return err("Test topilmadi.");
    const r: Room = { code: code(), hostId: userId, quiz: pick(quiz, b.count, false, undefined, undefined, b.shuffleQuestions === true), players: new Map(), banned: new Set(), status: "lobby", i: -1, endsAt: 0, startedAt: Date.now() };
    r.players.set(userId, { picks: {}, userId, score: 0, streak: 0, connected: true, lastSeen: Date.now() });
    rooms.set(r.code, r); push(r);
  });
  socket.on("room:join", (b: any = {}) => {
    if (roomOf(userId)) return err("Siz allaqachon xonadasiz.");
    const r = rooms.get(clean(b.code, 8).toUpperCase());
    if (!r) return err("Bunday xona topilmadi. Kodni tekshiring.");
    if (r.banned.has(userId)) return err("Siz bu xonadan chiqarilgansiz.");
    if (r.status !== "lobby") return err("O‘yin allaqachon boshlangan.");
    if (r.players.size >= MAX_PLAYERS) return err("Xona to‘lgan.");
    r.players.set(userId, { picks: {}, userId, score: 0, streak: 0, connected: true, lastSeen: Date.now() }); push(r);
  });
  socket.on("room:leave", () => { const r = roomOf(userId); if (r) removeFrom(r, userId); socket.emit("room:none"); });
  socket.on("room:kick", (b: any = {}) => {
    const r = roomOf(userId); if (!r || r.hostId !== userId) return;
    const t = String(b.userId); if (t === userId || !r.players.has(t)) return;
    r.banned.add(t); removeFrom(r, t); io.to("u:" + t).emit("room:none"); io.to("u:" + t).emit("room:error", "Siz xonadan chiqarildingiz.");
  });
  socket.on("game:start", () => {
    const r = roomOf(userId); if (!r || r.hostId !== userId) return err("Faqat xona egasi boshlay oladi.");
    if (r.status !== "lobby") return;
    if (r.players.size < 2) return err("Boshlash uchun kamida 2 o‘yinchi kerak.");
    ask(r, 0);
  });
  socket.on("game:answer", (b: any = {}) => {
    const r = roomOf(userId); if (!r || r.status !== "question") return;
    const p = r.players.get(userId)!; const q = r.quiz.questions[r.i];
    if (p.answer !== undefined || Date.now() > r.endsAt + 500) return;
    const idx = b.index; if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) return;
    p.answer = idx; p.picks[r.i] = idx; p.correct = idx === q.correct; p.points = 0;
    if (p.correct) { p.streak += 1; p.points = pointsFor(r.endsAt - Date.now(), q.time * 1000, p.streak - 1); p.score += p.points; } else p.streak = 0;
    if ([...r.players.values()].every(x => x.answer !== undefined || !x.connected)) reveal(r); else push(r);
  });
  socket.on("game:next", () => {
    const r = roomOf(userId); if (!r || r.hostId !== userId || r.status !== "results") return;
    r.i + 1 >= r.quiz.questions.length ? finish(r) : ask(r, r.i + 1);
  });
  socket.on("game:end", () => {
    const r = roomOf(userId); if (!r) return;
    if (r.hostId !== userId) return err("Testni faqat boshlovchi yakunlay oladi.");
    if (r.status === "question" || r.status === "results") finish(r);
  });
  socket.on("game:skip", () => { const r = roomOf(userId); if (r && r.hostId === userId) reveal(r); });
  socket.on("room:react", (b: any = {}) => {
    const r = roomOf(userId); if (!r || !REACTIONS.includes(b.emoji)) return;
    io.to([...r.players.keys()].map(i => "u:" + i)).emit("room:reaction", { userId, emoji: b.emoji, id: uid() });
  });
  socket.on("disconnect", () => {
    const c = (online.get(userId) || 1) - 1; c <= 0 ? online.delete(userId) : online.set(userId, c); pushOnline();
    if (io.sockets.adapter.rooms.get("u:" + userId)?.size) return; // boshqa ulanish bor
    const r = roomOf(userId); if (!r) return;
    const p = r.players.get(userId)!; p.connected = false; p.lastSeen = Date.now();
    if (r.hostId === userId) { const n = [...r.players.entries()].find(([, x]) => x.connected); if (n) r.hostId = n[0]; }
    if (r.status === "question" && [...r.players.values()].every(x => x.answer !== undefined || !x.connected)) reveal(r); else push(r);
  });
});

// ---- Frontend (production) ----
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "1h" }));
  app.get("*", (req, res, next) => (req.path.startsWith("/api") ? next() : res.sendFile(resolve(dist, "index.html"))));
}
await initStore();
seedQuizzes();
server.listen(PORT, () => { console.log(`Quiz Arena: http://localhost:${PORT}`); startBot(); });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { setTimeout(() => process.exit(0), 4000).unref(); Promise.resolve(flushNow()).finally(() => process.exit(0)); });
