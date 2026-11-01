// AI MUHANDIS: loyiha kodini o‘qiydi, xatolarni o‘zbekcha tushuntiradi va "/tuzat" buyrug‘i bilan tuzatish (patch) tayyorlaydi.
// Faqat ADMIN_PASSWORD bilan ishlaydi. Tuzatishlar avtomatik qo‘llanmaydi: foydalanuvchi "Qo‘llash" tugmasini bosadi,
// shundan so‘ng GitHub'ga commit qilinadi (GITHUB_TOKEN + GITHUB_REPO) va Render o‘zi qayta joylaydi.
import type { Express, NextFunction, Request, Response } from "express";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ChatMsg, GROQ_TEXT_MODELS, GROQ_TOOL_MODELS, groqChat, groqEnabled, groqLastError } from "./groq.js";
import { UZ_STYLE, looksUzbek } from "./uz.js";
import { kvLoad, kvSave } from "./store.js";

type Mw = (req: Request, res: Response, next: NextFunction) => unknown;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------- fayllar
const CODE_DIRS = ["server/src", "client/src"];
const EXTRA = ["README.md", "render.yaml", "package.json", "server/package.json", "client/package.json", "client/index.html", "client/vite.config.ts"];
const DATA_FILES = new Set(["server/src/bulutli-texnologiyalar.ts", "server/src/bbl-tests.ts"]); // katta savol bazalari: qidiruvga kirmaydi, tuzatilmaydi
const NO_PATCH = new Set(["server/src/devai.ts", "server/src/auth.ts", ...DATA_FILES]); // AI o‘zini va xavfsizlik kodini o‘zgartira olmaydi
const PATCHABLE = /\.(ts|tsx|css|md|yaml|html)$/;
// Foydalanuvchi talabi bilan ataylab shunday qoldirilgan joylar: AI ularni o‘zgartira olmaydi.
const PROTECTED: RegExp[] = [/quick-search/i, /QuickSearch/, /ADMIN_PASSWORD/, /removeQuiz/, /app\.delete\(\s*["']\/api\/quizzes/];

function walk(dir: string, out: string[]) {
  let names: string[] = [];
  try { names = readdirSync(resolve(ROOT, dir)); } catch { return; }
  for (const n of names.sort()) {
    if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
    const rel = `${dir}/${n}`;
    let st; try { st = statSync(resolve(ROOT, rel)); } catch { continue; }
    if (st.isDirectory()) walk(rel, out); else out.push(rel);
  }
}
export function listFiles(): { path: string; size: number; data: boolean }[] {
  const all: string[] = []; for (const d of CODE_DIRS) walk(d, all);
  for (const f of EXTRA) if (existsSync(resolve(ROOT, f))) all.push(f);
  return all.map(path => ({ path, size: (() => { try { return statSync(resolve(ROOT, path)).size; } catch { return 0; } })(), data: DATA_FILES.has(path) }));
}
function safePath(p: unknown): string | null {
  if (typeof p !== "string") return null;
  const norm = p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
  if (!norm || norm.includes("..") || /(^|\/)(\.env|\.git|node_modules)/.test(norm)) return null;
  if (!(EXTRA.includes(norm) || CODE_DIRS.some(d => norm.startsWith(d + "/")))) return null;
  const abs = resolve(ROOT, norm);
  return abs.startsWith(ROOT + sep) ? norm : null;
}
function readLocal(path: string): string | null { try { return readFileSync(resolve(ROOT, path), "utf8"); } catch { return null; } }

// ---------------------------------------------------------------- jurnal (doimiy kuzatuv)
type LogEntry = { t: number; src: string; msg: string; stack?: string; where?: string; n: number };
let LOGS: LogEntry[] = [];
let logsDirty = false;
type Report = { t: number; issues: number; newErrors: number; summary: string; fp: string };
let REPORT: Report | null = null;
let lastScanAt = 0;

export function recordError(src: string, msg: string, stack?: string, where?: string) {
  const m = String(msg || "").slice(0, 500); if (!m) return;
  const last = LOGS[LOGS.length - 1];
  if (last && last.msg === m && last.src === src) { last.n++; last.t = Date.now(); }
  else { LOGS.push({ t: Date.now(), src, msg: m, stack: stack ? String(stack).slice(0, 900) : undefined, where: where ? String(where).slice(0, 200) : undefined, n: 1 }); if (LOGS.length > 150) LOGS.shift(); }
  logsDirty = true;
}
const fmtLog = (l: LogEntry) => `[${new Date(l.t).toISOString().slice(0, 19).replace("T", " ")}] ${l.src}${l.n > 1 ? ` ×${l.n}` : ""}${l.where ? ` @${l.where}` : ""}: ${l.msg}${l.stack ? "\n" + l.stack.split("\n").slice(0, 4).join("\n") : ""}`;

/** Server xatolarini (console.error, ushlanmagan xatolar) avtomatik jurnalga yozadi. */
export function installErrorCapture() {
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    orig(...args);
    try { recordError("server", args.map(a => a instanceof Error ? (a.stack || a.message) : typeof a === "string" ? a : JSON.stringify(a)).join(" ")); } catch { /* e'tiborsiz */ }
  };
  process.on("unhandledRejection", (e: any) => { recordError("server", "unhandledRejection: " + (e?.stack || e?.message || String(e))); });
  process.on("uncaughtException", (e: any) => {
    recordError("server", "uncaughtException: " + (e?.stack || e?.message || String(e)));
    void kvSave("devlog", { logs: LOGS, report: REPORT }).finally(() => process.exit(1)); // Render qayta ishga tushiradi
  });
}

// ---------------------------------------------------------------- statik tekshiruv (AI'siz, tez va ishonchli)
export type Issue = { sev: "xato" | "ogohlantirish"; file: string; line: number; msg: string };
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " ")).replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseImports(code: string): { clause: string; from: string; index: number; typeOnly: boolean }[] {
  const out: { clause: string; from: string; index: number; typeOnly: boolean }[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g; let m: RegExpExecArray | null;
  while ((m = re.exec(code))) { if (m[2].length > 600) continue; out.push({ clause: m[2], from: m[3], index: m.index, typeOnly: !!m[1] }); }
  return out;
}
function clauseNames(clause: string): { def?: string; named: string[] } {
  const named: string[] = []; let def: string | undefined;
  const br = /\{([\s\S]*?)\}/.exec(clause);
  if (br) for (const part of br[1].split(",")) { const t = part.trim().replace(/^type\s+/, ""); if (!t) continue; named.push(t.split(/\s+as\s+/)[0].trim()); }
  const head = clause.replace(/\{[\s\S]*?\}/, "").replace(/,/g, " ").trim();
  if (head && !head.startsWith("*")) def = head.split(/\s+/)[0];
  return { def, named };
}
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(ROOT, dirname(fromFile), spec).replace(/\\/g, "/");
  const root = ROOT.replace(/\\/g, "/");
  const stem = base.replace(/\.js$/, "");
  for (const c of [stem + ".ts", stem + ".tsx", stem + "/index.ts", stem + "/index.tsx", base]) {
    if (c.startsWith(root + "/") && existsSync(c) && statSync(c).isFile()) return c.slice(root.length + 1);
  }
  return null;
}
const exportsName = (src: string, name: string) =>
  new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|class|type|interface|enum|const|let|var)\\s+${esc(name)}\\b`).test(src) ||
  new RegExp(`export\\s*\\{[^}]*\\b${esc(name)}\\b[^}]*\\}`).test(src) ||
  new RegExp(`export\\s+(?:const|let|var)\\s+[^;]*\\b${esc(name)}\\s*[=:]`).test(src);

export function staticScan(): Issue[] {
  const issues: Issue[] = [];
  const files = listFiles().filter(f => !f.data && /\.(ts|tsx)$/.test(f.path));
  const src = new Map<string, string>();
  for (const f of files) { const s = readLocal(f.path); if (s !== null) src.set(f.path, s); }

  for (const [file, raw] of src) {
    const code = stripComments(raw);
    // 1) JSX komponent ishlatilgan, lekin import/e'lon qilinmagan (masalan, <Plus /> import qilinmagan)
    if (file.endsWith(".tsx")) {
      const seen = new Set<string>(); const re = /(^|[^\w$.])<([A-Z][\w$]*)(?=[\s/>.])/g; let m: RegExpExecArray | null;
      while ((m = re.exec(code))) {
        const name = m[2]; if (seen.has(name) || name === "Fragment") continue; seen.add(name);
        const all = (code.match(new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`, "g")) || []).length;
        const tags = (code.match(new RegExp(`</?${esc(name)}(?![\\w$])`, "g")) || []).length;
        if (all - tags <= 0) issues.push({ sev: "xato", file, line: lineOf(code, m.index + m[1].length), msg: `<${name} /> ishlatilgan, lekin import qilinmagan yoki e'lon qilinmagan. Ilova shu joyga kelganda ReferenceError bilan qulaydi.` });
      }
    }
    // 2) nisbiy importlar: fayl va nomlar mavjudmi
    for (const imp of parseImports(code)) {
      if (!imp.from.startsWith(".")) continue;
      const target = resolveImport(file, imp.from);
      const line = lineOf(code, imp.index);
      if (!target) { issues.push({ sev: "xato", file, line, msg: `"${imp.from}" fayli topilmadi.` }); continue; }
      const tsrc = src.get(target) ?? readLocal(target) ?? ""; const { def, named } = clauseNames(imp.clause);
      if (def && !/export\s+default\b/.test(tsrc)) issues.push({ sev: "xato", file, line, msg: `"${imp.from}" ichida default export yo'q, lekin "${def}" default sifatida import qilingan.` });
      for (const n of named) if (!exportsName(tsrc, n)) issues.push({ sev: "xato", file, line, msg: `"${n}" nomi "${imp.from}" faylidan export qilinmagan.` });
    }
  }

  // 3) client chaqirgan API yo'llari serverda bormi
  const routes: RegExp[] = [];
  for (const f of ["server/src/index.ts", "server/src/devai.ts"]) {
    const s = src.get(f); if (!s) continue; const re = /app\.(?:get|post|put|patch|delete)\(\s*["'`](\/api[^"'`]*)["'`]/g; let m: RegExpExecArray | null;
    while ((m = re.exec(s))) routes.push(new RegExp("^" + m[1].split("?")[0].replace(/:[A-Za-z_]+/g, "[^/]+").replace(/\*/g, ".*") + "$"));
  }
  if (routes.length) for (const [file, raw] of src) {
    if (!file.startsWith("client/src/")) continue;
    const code = stripComments(raw); let m: RegExpExecArray | null;
    const re2 = /(?:\bapi(?:<[^>]*>)?\(\s*(?:"(\/api\/[^"]*)"|`(\/api\/[^`]*)`))|(?:\$\{SERVER\}(\/api\/[^`"]*))/g;
    while ((m = re2.exec(code))) {
      const path = (m[1] || m[2] || m[3] || "").replace(/\$\{[^}]*\}/g, "x").split("?")[0];
      if (path && !routes.some(r => r.test(path))) issues.push({ sev: "xato", file, line: lineOf(code, m.index), msg: `Client "${path}" manziliga murojaat qiladi, lekin serverda bunday yo'l yo'q (404 qaytadi).` });
    }
  }
  return issues;
}

// ---------------------------------------------------------------- tuzatishlar (patch)
type Patch = { id: string; path: string; oldStr: string; newStr: string; explanation: string; created: number };
const PATCHES = new Map<string, Patch>();
const gcPatches = () => { const now = Date.now(); for (const [k, p] of PATCHES) if (now - p.created > 2 * 3600e3) PATCHES.delete(k); };

async function syntaxCheck(path: string, code: string): Promise<string | null> {
  if (!/\.(ts|tsx)$/.test(path)) return null;
  try {
    const name = "typescript"; const mod: any = await import(name); const T = mod.default || mod;
    const out = T.transpileModule(code, { fileName: path, reportDiagnostics: true, compilerOptions: { target: T.ScriptTarget.ES2022, module: T.ModuleKind.ESNext, jsx: T.JsxEmit.Preserve } });
    const errs = (out.diagnostics || []).filter((d: any) => d.category === 1);
    if (errs.length) {
      const d = errs[0]; const line = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      return `Sintaksis xatosi${line ? ` (${line}-qator)` : ""}: ${T.flattenDiagnosticMessageText(d.messageText, " ")}`;
    }
  } catch { /* typescript serverda yo'q: tekshiruv o'tkazib yuboriladi */ }
  return null;
}
const countOcc = (hay: string, needle: string) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length || 1; } return n; };

async function proposePatch(a: any): Promise<string> {
  const path = safePath(a?.path); const oldStr = typeof a?.old_str === "string" ? a.old_str : ""; const newStr = typeof a?.new_str === "string" ? a.new_str : "";
  if (!path) return "XATO: bunday fayl yo'q yoki unga ruxsat yo'q.";
  if (NO_PATCH.has(path) || !PATCHABLE.test(path)) return "XATO: bu faylni o'zgartirish taqiqlangan.";
  if (!oldStr || oldStr === newStr) return "XATO: old_str bo'sh yoki new_str bilan bir xil.";
  if (oldStr.length > 3000 || newStr.length > 5000) return "XATO: patch juda katta. Kichikroq bo'laklarga bo'ling.";
  if (PROTECTED.some(re => re.test(oldStr))) return "XATO: bu qism foydalanuvchi talabi bilan himoyalangan (Tez topish yoki parol bilan o'chirish). O'zgartirma.";
  const cur = readLocal(path); if (cur === null) return "XATO: fayl o'qilmadi.";
  const n = countOcc(cur, oldStr);
  if (n === 0) return "XATO: old_str faylda topilmadi. read_file bilan aniq matnni qayta ko'chiring (bo'shliqlar bilan).";
  if (n > 1) return `XATO: old_str faylda ${n} marta uchraydi. Atrofidan ko'proq qator qo'shib, noyob qiling.`;
  const syn = await syntaxCheck(path, cur.replace(oldStr, () => newStr));
  if (syn) return "XATO: patch sintaksisni buzadi. " + syn;
  gcPatches();
  const id = randomBytes(4).toString("hex");
  PATCHES.set(id, { id, path, oldStr, newStr, explanation: String(a?.explanation || "").slice(0, 400), created: Date.now() });
  return `OK: patch #${id} navbatga qo'yildi (hali qo'llanmagan).`;
}

const GH_TOKEN = process.env.GITHUB_TOKEN || "", GH_REPO = process.env.GITHUB_REPO || "", GH_BRANCH = process.env.GITHUB_BRANCH || "main";
const GH_PREFIX = (process.env.GITHUB_PATH_PREFIX || "").replace(/^\/|\/$/g, "");
const ghUrl = (p: string) => `https://api.github.com/repos/${GH_REPO}/contents/${(GH_PREFIX ? GH_PREFIX + "/" : "") + p.split("/").map(encodeURIComponent).join("/")}`;
const ghHeaders = () => ({ authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "quiz-arena-ai-muhandis", "content-type": "application/json" });
const canGithub = !!(GH_TOKEN && GH_REPO);
const localWrite = process.env.DEVAI_LOCAL_WRITE === "true";

async function applyPatch(p: Patch): Promise<{ ok: boolean; message: string; url?: string }> {
  if (canGithub) {
    try {
      const g = await fetch(`${ghUrl(p.path)}?ref=${encodeURIComponent(GH_BRANCH)}`, { headers: ghHeaders() });
      if (!g.ok) return { ok: false, message: `GitHub'dan fayl o'qilmadi (${g.status}). GITHUB_REPO, GITHUB_BRANCH va token ruxsatini tekshiring.` };
      const j: any = await g.json();
      const content = Buffer.from(String(j.content || "").replace(/\n/g, ""), "base64").toString("utf8");
      const n = countOcc(content, p.oldStr);
      if (n !== 1) return { ok: false, message: `GitHub'dagi fayl o'zgargan (old_str ${n} marta topildi). Tahlilni qayta ishga tushiring.` };
      const next = content.replace(p.oldStr, () => p.newStr);
      const syn = await syntaxCheck(p.path, next); if (syn) return { ok: false, message: syn };
      const put = await fetch(ghUrl(p.path), { method: "PUT", headers: ghHeaders(), body: JSON.stringify({ message: `AI muhandis: ${p.explanation || p.path}`.slice(0, 200), content: Buffer.from(next, "utf8").toString("base64"), sha: j.sha, branch: GH_BRANCH }) });
      if (!put.ok) return { ok: false, message: `GitHub'ga yozilmadi (${put.status}): ${(await put.text().catch(() => "")).slice(0, 160)}` };
      const r: any = await put.json();
      return { ok: true, message: "GitHub'ga yuborildi. Render bir necha daqiqada qayta joylaydi.", url: r?.commit?.html_url };
    } catch (e: any) { return { ok: false, message: "GitHub bilan aloqa xatosi: " + String(e?.message || e).slice(0, 120) }; }
  }
  if (localWrite) {
    const cur = readLocal(p.path); if (cur === null) return { ok: false, message: "Fayl o'qilmadi." };
    if (countOcc(cur, p.oldStr) !== 1) return { ok: false, message: "Fayl o'zgargan: old_str endi aynan bir marta topilmadi." };
    const next = cur.replace(p.oldStr, () => p.newStr);
    const syn = await syntaxCheck(p.path, next); if (syn) return { ok: false, message: syn };
    writeFileSync(resolve(ROOT, p.path), next, "utf8");
    return { ok: true, message: "Mahalliy faylga yozildi (lokal rejim)." };
  }
  return { ok: false, message: "Avtomatik qo'llash o'chiq: Render Environment'ga GITHUB_TOKEN va GITHUB_REPO qo'shing. Hozircha o'zgarishni qo'lda kiriting." };
}

// ---------------------------------------------------------------- agent (asboblar bilan)
const T = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const TOOLS = [
  T("list_files", "Loyiha fayllari ro'yxati va hajmi."),
  T("read_file", "Faylni qator raqamlari bilan o'qiydi (bir chaqiruvda ~180 qator). Uzun fayl uchun start_line/end_line bering.", { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } }, ["path"]),
  T("search_code", "Barcha kod fayllaridan matn qidiradi (katta-kichik harf farqsiz). Natija: fayl:qator: matn.", { query: { type: "string" } }, ["query"]),
  T("static_scan", "Avtomatik tekshiruv: import qilinmagan komponentlar, topilmagan fayl/nomlar, serverda yo'q API yo'llari."),
  T("get_logs", "Oxirgi server va client xatolari jurnali.", { limit: { type: "integer" } }),
  T("propose_patch", "Tuzatish taklif qiladi (faqat TUZATISH rejimida). old_str faylda aynan 1 marta uchrashi kerak.", { path: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" }, explanation: { type: "string" } }, ["path", "old_str", "new_str", "explanation"])
];

function readTool(a: any): string {
  const path = safePath(a?.path); if (!path) return "XATO: bunday fayl yo'q yoki unga ruxsat yo'q. list_files bilan tekshiring.";
  const s = readLocal(path); if (s === null) return "XATO: fayl o'qilmadi.";
  const lines = s.split("\n"); const total = lines.length;
  const start = Math.max(1, Math.floor(Number(a?.start_line) || 1)); let end = Math.min(total, Math.floor(Number(a?.end_line) || start + 179)); end = Math.min(end, start + 179);
  let out = `${path} (${total} qator, ${s.length} belgi)\n`; let used = out.length;
  for (let i = start; i <= end; i++) {
    const row = `${i}: ${lines[i - 1].slice(0, 400)}\n`;
    if (used + row.length > 6500) { out += `[davomi bor: start_line=${i}]`; return out; }
    out += row; used += row.length;
  }
  if (end < total) out += `[davomi bor: start_line=${end + 1}]`;
  return out;
}
function searchTool(a: any): string {
  const q = String(a?.query || "").trim().toLowerCase(); if (q.length < 2) return "XATO: qidiruv so'zi juda qisqa.";
  const hits: string[] = [];
  for (const f of listFiles()) {
    if (f.data || f.size > 200000) continue; const s = readLocal(f.path); if (s === null) continue;
    const lines = s.split("\n");
    for (let i = 0; i < lines.length && hits.length < 30; i++) if (lines[i].toLowerCase().includes(q)) hits.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 140)}`);
    if (hits.length >= 30) break;
  }
  return hits.length ? hits.join("\n") : "Hech narsa topilmadi.";
}
function scanText(): string {
  const issues = staticScan();
  return issues.length ? issues.slice(0, 40).map(i => `${i.sev.toUpperCase()} ${i.file}:${i.line}: ${i.msg}`).join("\n") : "Avtomatik tekshiruv hech narsa topmadi.";
}
async function execTool(name: string, args: any, mode: "analyze" | "fix"): Promise<string> {
  try {
    if (name === "list_files") return listFiles().map(f => `${f.path} (${f.size} bayt${f.data ? ", savollar bazasi" : ""})`).join("\n");
    if (name === "read_file") return readTool(args);
    if (name === "search_code") return searchTool(args);
    if (name === "static_scan") return scanText();
    if (name === "get_logs") { const n = Math.min(40, Math.max(1, Number(args?.limit) || 20)); return LOGS.length ? LOGS.slice(-n).map(fmtLog).join("\n---\n").slice(0, 6000) : "Jurnal bo'sh: xato qayd etilmagan."; }
    if (name === "propose_patch") return mode === "fix" ? await proposePatch(args) : "XATO: hozir tahlil rejimi. Tuzatish uchun foydalanuvchi /tuzat buyrug'ini berishi kerak.";
    return "XATO: noma'lum asbob.";
  } catch (e: any) { return "XATO: " + String(e?.message || e).slice(0, 200); }
}

function systemPrompt(mode: "analyze" | "fix"): string {
  const base =
    "Sen “Quiz Arena” loyihasining AI muhandisisan. Loyiha: Telegram Mini App; frontend React + Vite (client/src), backend Node.js + Express + Socket.IO (server/src). " +
    "VAZIFANG: kodni tahlil qilish, xatolarni topish va ularni oddiy o‘zbek tilida tushuntirish. " +
    "ASBOBLAR: list_files, read_file, search_code, static_scan, get_logs. Javob berishdan oldin kerakli fayllarni albatta o‘qi; taxmin qilma, o‘qimagan kodingni tasvirlama. " +
    "HAR BIR MUAMMO UCHUN: 1) Qayerda (fayl va qator), 2) Nima xato, 3) Nima uchun muammo (oqibati nima), 4) Qanday tuzatiladi. Jiddiylik bo‘yicha tartibla. Muammo topilmasa, shuni ayt. " +
    "QOIDALAR: faqat o‘qigan kodingga tayan; ishonching komil bo‘lmasa “tekshirish kerak” de. " +
    "Quyidagilar foydalanuvchi talabi bilan ATAYLAB shunday qoldirilgan, ularni xato deb hisoblama va o‘zgartirishni taklif qilma: “Tez topish” bo‘limi (QuickSearch, /api/quick-search, qidiruv natijalarida to‘g‘ri javob ko‘rsatilishi) hamda testni ADMIN_PASSWORD bilan o‘chirish. " +
    "Javob mobil ekranga mos: qisqa abzaslar, markdown jadval ishlatma. ";
  const fix = mode === "fix"
    ? "TUZATISH REJIMI: foydalanuvchi tuzatishni so‘radi. Avval static_scan, get_logs va kerakli fayllarni o‘qi. Har bir ANIQ tasdiqlangan xato uchun propose_patch chaqir: old_str faylda AYNAN BIR MARTA uchrasin (read_file dan bo‘shliqlari bilan nusxa ko‘chir), kichik va aniq bo‘lsin; boshqa joyni buzma, yangi kutubxona qo‘shma. Bitta so‘rovda ko‘pi bilan 5 ta patch. propose_patch xato qaytarsa, tuzatib qayta urin. Oxirida nima o‘zgartirilganini o‘zbekcha qisqa yoz va “Qo‘llash” tugmasini bosishni ayt (patchlar hali qo‘llanmagan)."
    : "TAHLIL REJIMI: kodni o‘zgartirma. Foydalanuvchi “/tuzat” buyrug‘ini yoki “Tuzatish” tugmasini bossa, tuzatish rejimiga o‘tiladi — oxirida shuni eslat.";
  return base + fix + " " + UZ_STYLE;
}

/** Eski asbob natijalarini qisqartirib, so'rov hajmini (Groq limiti) nazorat qiladi. */
function prune(messages: ChatMsg[]) {
  const size = () => messages.reduce((n, m) => n + (m.content?.length || 0) + (m.tool_calls ? 300 : 0), 0);
  const toolIdx = messages.map((m, i) => (m.role === "tool" ? i : -1)).filter(i => i >= 0);
  for (const i of toolIdx.slice(0, -2)) { if (size() <= 22000) break; const c = messages[i].content || ""; if (c.length > 400) messages[i].content = c.slice(0, 350) + "\n…[eski natija qisqartirildi]"; }
}
const parseArgs = (s: unknown) => { try { return JSON.parse(String(s || "{}")); } catch { return null; } };

type AgentOut = { reply: string; patches: Patch[]; steps: string[]; error?: string };
async function runAgent(history: { role: "user" | "assistant"; text: string }[], mode: "analyze" | "fix"): Promise<AgentOut> {
  const tools = mode === "fix" ? TOOLS : TOOLS.filter(t => t.function.name !== "propose_patch");
  const messages: ChatMsg[] = [{ role: "system", content: systemPrompt(mode) }, ...history.slice(-8).map(h => ({ role: h.role, content: h.text.slice(0, 1500) } as ChatMsg))];
  const before = new Set(PATCHES.keys()); const steps: string[] = [];
  const newPatches = () => [...PATCHES.values()].filter(p => !before.has(p.id));
  for (let i = 0; i < 9; i++) {
    prune(messages);
    const r = await groqChat(messages, { models: GROQ_TOOL_MODELS, tools, temperature: 0.2, maxTokens: 2500, timeoutMs: 50000 });
    if (!r) return { reply: "", patches: newPatches(), steps, error: groqLastError || "AI javob bermadi." };
    const calls: any[] = r.message.tool_calls || [];
    if (!calls.length) return { reply: await ensureUz(r.text), patches: newPatches(), steps };
    messages.push({ role: "assistant", content: r.message.content || null, tool_calls: calls });
    for (const c of calls) {
      const name = String(c?.function?.name || ""); const args = parseArgs(c?.function?.arguments);
      const out = args === null ? "XATO: argumentlar JSON emas." : await execTool(name, args, mode);
      steps.push(`${name}${args?.path ? " " + args.path : args?.query ? ` “${String(args.query).slice(0, 30)}”` : ""}`);
      messages.push({ role: "tool", tool_call_id: String(c.id), content: out.slice(0, 7000) });
    }
  }
  const gathered = messages.filter(m => m.role === "tool").map(m => (m.content || "").slice(0, 1500)).join("\n---\n").slice(-12000);
  const plain: ChatMsg[] = [messages[0], ...messages.slice(1).filter(m => m.role === "user" || (m.role === "assistant" && !m.tool_calls)),
    { role: "user", content: `Asboblar natijalari:\n${gathered}\n\nEndi asboblarsiz, shu ma'lumotlar asosida yakuniy javobni o‘zbekcha yoz.` }];
  const fin = await groqChat(plain, { models: GROQ_TEXT_MODELS, temperature: 0.2, maxTokens: 2000, timeoutMs: 50000 });
  return fin ? { reply: await ensureUz(fin.text), patches: newPatches(), steps } : { reply: "", patches: newPatches(), steps, error: groqLastError || "AI yakuniy javob bermadi." };
}
async function ensureUz(text: string): Promise<string> {
  const t = text.trim(); if (!t || looksUzbek(t)) return t;
  const r = await groqChat([{ role: "system", content: "Quyidagi matnni ma'nosini saqlagan holda FAQAT lotin yozuvidagi sof o‘zbek tilida qayta yoz. Kod, fayl nomlari va texnik atamalarni o‘zgartirma. " + UZ_STYLE }, { role: "user", content: t }], { models: GROQ_TEXT_MODELS, temperature: 0.1, maxTokens: 2000, timeoutMs: 30000 });
  return r && r.text ? r.text : t;
}

// ---------------------------------------------------------------- doimiy tahlil (rejalashtirilgan)
async function persist() { if (logsDirty) { logsDirty = false; await kvSave("devlog", { logs: LOGS, report: REPORT }); } }
async function autoAnalyze() {
  try {
    const issues = staticScan(); const recent = LOGS.filter(l => l.t > lastScanAt); lastScanAt = Date.now();
    const fp = createHash("sha1").update(JSON.stringify(issues.map(i => i.file + i.line + i.msg)) + recent.map(l => l.msg).join("|")).digest("hex").slice(0, 12);
    const changed = !REPORT || REPORT.fp !== fp;
    REPORT = { t: Date.now(), issues: issues.length, newErrors: recent.length, summary: REPORT?.summary || "", fp };
    if (changed && (issues.length || recent.length) && groqEnabled) {
      const out = await runAgent([{ role: "user", text: `Avtomatik rejalashtirilgan tekshiruv. Statik tekshiruv ${issues.length} ta muammo topdi, jurnalda ${recent.length} ta yangi xato bor. Eng muhimlarini 5–8 qatorda o‘zbekcha qisqa yoz.` }], "analyze");
      if (out.reply) REPORT.summary = out.reply.slice(0, 2500);
    }
    logsDirty = true; await persist();
  } catch (e) { console.error("Avtomatik tahlil xatosi:", String(e).slice(0, 200)); }
}
export async function startDevAi() {
  const saved = await kvLoad("devlog");
  if (saved?.logs && Array.isArray(saved.logs)) LOGS = saved.logs.slice(-150);
  if (saved?.report) REPORT = saved.report;
  lastScanAt = REPORT?.t || 0;
  setInterval(() => { void persist(); }, 30000).unref();
  const hours = Number(process.env.DEVAI_AUTO_HOURS ?? 6);
  setTimeout(() => { void autoAnalyze(); }, 90000).unref();
  if (hours > 0) setInterval(() => { void autoAnalyze(); }, hours * 3600e3).unref();
}

// ---------------------------------------------------------------- HTTP yo'llar
const sha = (x: string) => createHash("sha256").update(x).digest();
function adminOk(req: Request): boolean {
  const pass = process.env.ADMIN_PASSWORD || "";
  const given = typeof req.body?.password === "string" ? req.body.password.slice(0, 100) : "";
  return !!pass && timingSafeEqual(sha(given), sha(pass));
}
const cleanStr = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "");

export function registerDevAi(app: Express, deps: { auth: Mw; limit: (max: number, windowMs: number) => Mw }) {
  const gate: Mw = (req, res, next) => {
    if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: "ADMIN_PASSWORD o‘rnatilmagan: AI muhandis yoqilmagan." });
    if (!adminOk(req)) return res.status(403).json({ error: "Parol noto‘g‘ri." });
    next();
  };
  // Client xatolarini jurnalga yozish (ErrorBoundary va window.onerror)
  app.post("/api/client-error", deps.limit(20, 60000), (req, res) => {
    recordError("client", cleanStr(req.body?.message, 400), cleanStr(req.body?.stack, 900), cleanStr(req.body?.where, 120));
    res.json({ ok: true });
  });
  app.post("/api/dev/report", deps.auth, deps.limit(10, 60000), gate, (_req, res) => {
    const issues = staticScan();
    res.json({ issues, logs: LOGS.slice(-30).map(fmtLog), report: REPORT, groq: groqEnabled, github: canGithub, local: localWrite, autoHours: Number(process.env.DEVAI_AUTO_HOURS ?? 6) });
  });
  app.post("/api/dev/chat", deps.auth, deps.limit(12, 60000), gate, async (req, res) => {
    if (!groqEnabled) return res.status(503).json({ error: "AI muhandis uchun GROQ_API_KEY kerak." });
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const history = raw.slice(-10).map((m: any) => ({ role: m?.role === "assistant" ? "assistant" as const : "user" as const, text: cleanStr(m?.text, 2000) })).filter((m: { text: string }) => m.text.trim());
    if (!history.length || history[history.length - 1].role !== "user") return res.status(400).json({ error: "Xabar yo‘q." });
    const last = history[history.length - 1].text;
    const mode = req.body?.mode === "fix" || /^\s*\/?tuzat(ish)?\b/i.test(last) ? "fix" : "analyze";
    try {
      const out = await runAgent(history, mode);
      if (out.error && !out.reply) return res.status(502).json({ error: out.error });
      res.json({ mode, reply: out.reply, steps: out.steps, patches: out.patches.map(p => ({ id: p.id, path: p.path, explanation: p.explanation, oldStr: p.oldStr, newStr: p.newStr })) });
    } catch (e: any) { console.error("AI muhandis xatosi:", e); res.status(500).json({ error: "AI muhandis ishlamadi." }); }
  });
  app.post("/api/dev/apply", deps.auth, deps.limit(10, 60000), gate, async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 10).map((x: unknown) => String(x)) : [];
    const results: { id: string; ok: boolean; message: string; url?: string }[] = [];
    for (const id of ids) {
      const p = PATCHES.get(id);
      if (!p) { results.push({ id, ok: false, message: "Patch topilmadi yoki muddati o‘tgan (2 soat). Qayta tahlil qiling." }); continue; }
      const r = await applyPatch(p);
      if (r.ok) PATCHES.delete(id);
      results.push({ id, ...r });
    }
    res.json({ results });
  });
}
