import { bblQuestions } from "./bbl-tests.js";
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
  mk("Individual loyiha", "Loyiha boshqaruvi", "Loyihalarni boshqarish: rejalashtirish, xavflar, jadval, xarajat, jamoa, Agile va dasturiy ta’minot asoslari (200 ta savol)", [
    ["Loyiha deganda nima tushuniladi?", ["Tashkilotning kundalik operatsion faoliyati", "Muddatsiz davom etadigan xizmat ko‘rsatish jarayoni", "Takrorlanuvchi doimiy ishlab chiqarish faoliyati", "Noyob natija yaratish uchun vaqtinchalik faoliyat"], 3],
    ["Loyihaning operatsion faoliyatdan asosiy farqi nimada?", ["Aniq boshlanish va tugashiga ega bo‘lishi", "Tashkilot tuzilmasiga bog‘liq bo‘lmasligi", "Bir xil natijani qayta-qayta takrorlab berishi", "Doimiy resurslar bilan ta’minlanib turilishi"], 0],
    ["Loyiha boshqaruvining “uchlik cheklovi” (temir uchburchak) qaysi elementlardan iborat?", ["Qamrov, vaqt va xarajat", "Sifat, xavf va resurs", "Jamoa, mijoz va homiy", "Maqsad, vazifa va natija"], 0],
    ["PMBOK standarti qaysi tashkilot tomonidan ishlab chiqilgan?", ["Association for Project Management (APM)", "Institute of Electrical and Electronics Engineers (IEEE)", "Project Management Institute (PMI)", "International Organization for Standardization (ISO)"], 2],
    ["Loyiha hayotiy siklining to‘g‘ri ketma-ketligi qaysi?", ["Bajarish, boshlash, rejalashtirish, yakunlash", "Boshlash, bajarish, yakunlash, rejalashtirish", "Rejalashtirish, boshlash, yakunlash, bajarish", "Boshlash, rejalashtirish, bajarish, yakunlash"], 3],
    ["PMBOK bo‘yicha loyiha boshqaruvi jarayonlari nechta guruhga bo‘linadi?", ["6 ta", "4 ta", "5 ta", "3 ta"], 2],
    ["Monitoring va nazorat jarayonlari loyihaning qaysi davrida amalga oshiriladi?", ["Loyiha yopilishi arafasida bir marta", "Rejalashtirish tugaganidan so‘ng bir marta", "Loyiha boshidan oxirigacha uzluksiz", "Bajarish bosqichi yakunlangandan keyin"], 2],
    ["“Sharshara” (Waterfall) yondashuvining asosiy xususiyati nimada?", ["Bosqichlar qat’iy ketma-ketlikda bajariladi", "Bosqichlar parallel va mustaqil bajariladi", "Bosqichlar qisqa iteratsiyalarda takrorlanadi", "Talablar har bir sprintda qayta ko‘rib chiqiladi"], 0],
    ["Loyiha portfeli deganda nima tushuniladi?", ["Bitta loyihaning barcha hujjatlari saqlanadigan elektron papka", "Strategik maqsadlar uchun birlashtirilgan loyihalar to‘plami", "Loyiha menejerining ilgari bajargan ishlari va tajribasi to‘plami", "Bir loyiha doirasidagi barcha vazifalarning to‘liq ro‘yxati"], 1],
    ["Loyiha qamrovi (scope) nimani anglatadi?", ["Loyihani yakunlash uchun belgilangan oxirgi muddat bo’yicha", "Loyiha uchun ajratilgan umumiy moliyaviy mablag‘ hajmi", "Loyihada bajarilishi lozim bo‘lgan ishlar va natijalar chegarasi", "Loyiha jamoasi a’zolarining umumiy soni va tarkibi"], 2],
    ["Loyiha menejerining asosiy vazifasi nima?", ["Loyiha homiysi o‘rniga moliyaviy mablag‘ni taqdim etishning bosqichlari", "Loyihani belgilangan cheklovlar doirasida maqsadga yetkazish", "Loyihaning barcha dasturiy kodini mustaqil yozib chiqish", "Tashkilotning umumiy strategiyasini yakka o‘zi belgilash"], 1],
    ["Loyiha menejeri ish vaqtining katta qismini qaysi faoliyatga sarflaydi?", ["Texnik uskunalarni sozlash", "Dastur kodini yozish va tekshirish", "Kommunikatsiyaga", "Hujjatlarni arxivlash va saqlash"], 2],
    ["Loyiha homiysi (sponsor) kim?", ["Loyihani moliyalashtiruvchi va qo‘llab-quvvatlovchi shaxs", "Loyiha hujjatlarini mustaqil tekshiradigan tashqi auditor", "Loyiha natijasidan bevosita foydalanadigan oxirgi iste’molchi", "Loyiha jamoasidagi eng tajribali va malakali texnik mutaxassis"], 0],
    ["Rahbarlikning qaysi uslubida jamoa a’zolari qaror qabul qilishga jalb etiladi?", ["Direktiv uslub", "Byurokratik uslub", "Avtoritar uslub", "Demokratik uslub"], 3],
    ["“Xizmatkor-rahbar” (servant leadership) uslubining mohiyati nimada?", ["Rahbar jamoani mukofot va jazo tizimi orqali boshqaradi", "Rahbar jamoa ishiga aralashmay, unga to‘liq erkinlik beradi", "Rahbar barcha qarorlarni jamoa bilan maslahatlashmay qabul qiladi", "Rahbar jamoa ehtiyojlarini bosh o‘ringa qo‘yib, unga xizmat qiladi"], 3],
    ["Matritsali tashkiliy tuzilmada loyiha xodimi kimga hisobot beradi?", ["Funksional rahbarga, loyiha menejeriga", "Bevosita tashkilotning bosh direktoriga", "Mijoz tomonidan tayinlangan vakilga", "Loyiha homiysining o‘rinbosariga"], 0],
    ["Qaysi tashkiliy tuzilmada loyiha menejeri eng katta vakolatga ega bo‘ladi?", ["Loyihaviy tuzilmada", "Funksional tuzilmada", "Kuchsiz matritsali tuzilmada", "Muvozanatli matritsali tuzilmada"], 0],
    ["Loyiha menejerining “yumshoq ko‘nikmalari” (soft skills) qatoriga nima kiradi?", ["Kritik yo‘lni hisoblash va jadval tuzish", "WBS tuzish va ish paketlarini aniqlash", "Byudjetni hisoblash va xarajatni tahlil qilish", "Muzokara olib borish va nizolarni hal qilish"], 3],
    ["Loyiha menejeri va funksional rahbarning asosiy farqi nimada?", ["Ikkalasi bir xil vazifani turli nom ostida, teng vakolat bilan bajaradi", "Menejer moliyaviy, funksional rahbar esa texnik masalalarni boshqaradi", "Menejer vaqtinchalik loyihani, funksional rahbar doimiy bo‘linmani boshqaradi", "Menejer doimiy bo‘linmani, funksional rahbar vaqtinchalik loyihani boshqaradi"], 2],
    ["Loyiha menejeri qaysi hujjat orqali rasman tayinlanadi va vakolat oladi?", ["Yakuniy hisobot (Final Report)", "Loyiha ustavi (Project Charter)", "Xavflar reestri (Risk Register)", "O‘zgarish so‘rovi (Change Request)"], 1],
    ["Loyiha menejerining manfaatdor tomonlar bilan ishlashdagi asosiy vazifasi nima?", ["Ularning talablarini ahamiyatiga qaramay teng bajarish", "Ular bilan muloqotni loyiha homiysi orqali olib borish", "Ularning kutilmalarini aniqlash va muvozanatda boshqarish", "Ularga loyiha yakunida tayyor natijalarni taqdim etish"], 2],
    ["Loyiha boshqaruv rejasi (Project Management Plan) nima?", ["Loyiha qanday bajarilishi, nazorati va yopilishini belgilovchi hujjat", "Loyiha jamoasi a’zolarining ish haqi hisoblangan moliyaviy hujjat", "Mijoz bilan tuziladigan yuridik shartnoma va uning barcha ilovalari", "Loyiha yakunida tayyorlanadigan o‘rganilgan saboqlar hisoboti"], 0],
    ["“Bosqichma-bosqich aniqlashtirish” (progressive elaboration) tamoyili nimani anglatadi?", ["Ma’lumot ortgani sari reja tobora batafsillashtirib boriladi", "Reja loyiha boshida bir marta to‘liq tuzilib, o‘zgartirilmaydi", "Har bir bosqich oldingisi tugagach yangi jamoa bilan boshlanadi", "Rejani loyiha homiysi har bir bosqichda alohida tasdiqlaydi"], 0],
    ["“To‘lqinsimon rejalashtirish” (rolling wave planning) usulining mohiyati nimada?", ["Yaqin ishlar batafsil, uzoq istiqboldagi ishlar umumiy rejalashtiriladi", "Barcha ishlar loyiha boshida bir xil darajada batafsil rejalashtiriladi", "Ishlar navbatma-navbat turli jamoalarga taqsimlab rejalashtiriladi", "Uzoq istiqboldagi ishlar batafsil, yaqin ishlar umumiy rejalashtiriladi"], 0],
    ["Bazaviy reja (baseline) nima?", ["Loyiha yakunida haqiqiy natijalar asosida tuzilgan hisobot", "Tasdiqlangan va solishtirishga asos bo‘ladigan reja versiyasi", "Loyihaning birinchi qoralama tarzidagi tasdiqlanmagan rejasi", "Jamoa a’zolarining shaxsiy ish rejalari jamlanmasi"], 1],
    ["Analog baholash usuli nimaga asoslanadi?", ["Statistik bog‘liqlik va parametrik modellarga", "Bajarilgan o‘xshash loyihalar ma’lumotlariga", "Har bir ish paketini pastdan yuqoriga jamlashga", "Uch nuqtali optimistik va pessimistik baholarga"], 1],
    ["Uch nuqtali baholashda (PERT) kutilayotgan davomiylik formulasi qaysi?", ["(O + 2M + P) / 4", "(O + M + P) / 3", "(4O + M + 4P) / 9", "(O + 4M + P) / 6"], 3],
    ["Optimistik baho 4 kun, eng ehtimoliy baho 6 kun, pessimistik baho 14 kun bo‘lsa, PERT bo‘yicha kutilayotgan davomiylik necha kun?", ["8 kun", "7 kun", "6 kun", "9 kun"], 1],
    ["Pastdan yuqoriga (bottom-up) baholash usuli qanday amalga oshiriladi?", ["Har bir ish paketi alohida baholanib, natijalar jamlanadi", "Butun loyiha bir yo‘la tajribaga tayanib baholanadi", "Homiy belgilagan summa ishlarga teng bo‘lib chiqiladi", "O‘xshash loyiha xarajatlari to‘g‘ridan-to‘g‘ri ko‘chiriladi"], 0],
    ["Rejalashtirishda zaxira (contingency reserve) nima maqsadda ko‘zda tutiladi?", ["Aniqlangan xavflar yuzaga kelganda ularni qoplash uchun", "Jamoa a’zolarining yillik ta’tilini rejalashtirish uchun", "Loyiha homiysiga qo‘shimcha hisobot tayyorlash uchun", "Loyiha yakunlangandan keyingi texnik xizmat uchun"], 0],
    ["Agile yondashuvida rejalashtirish qanday amalga oshiriladi?", ["Loyiha boshida bir marta qat’iy va o‘zgarmas tarzda", "Iteratsiyalar bo‘yicha moslashuvchan va takroriy", "Har bir bosqichdan so‘ng tashqi auditor ishtirokida", "Mijoz ishtirokisiz jamoa ichida yopiq tarzda"], 1],
    ["Loyihaning manfaatdor tomoni (stakeholder) kim?", ["Loyihaga ta’sir qiluvchi yoki undan ta’sirlanuvchi shaxs", "Loyiha mahsulotini xarid qiladigan tashqi mijozlar", "Loyihaga mablag‘ kirituvchi aksiyador yoki investorlar guruhi", "Loyiha jamoasi tarkibidagi doimiy shtatdagi xodimlar"], 0],
    ["Manfaatdor tomonlarni aniqlash natijasi qaysi hujjatda qayd etiladi?", ["Muammolar jurnalida", "O‘zgarishlar jurnalida", "Xavflar reestrida", "Manfaatdorlar reestrida"], 3],
    ["“Vakolat/qiziqish” matritsasida yuqori vakolat va yuqori qiziqishga ega tomonlar bilan qanday ishlanadi?", ["Doimiy ravishda xabardor qilib turiladi", "Qoniqtirilgan holda ushlab turiladi", "Yaqindan boshqariladi", "Minimal kuzatuv ostida ushlab turiladi"], 2],
    ["Yuqori vakolatli, ammo past qiziqishli manfaatdor tomonlarga nisbatan qaysi strategiya qo‘llaniladi?", ["Doimiy xabardor qilib turish", "Yaqindan boshqarish", "Qoniqtirilgan holda ushlash", "Minimal kuzatib borish"], 2],
    ["Past vakolatli, ammo yuqori qiziqishli manfaatdor tomonlarga nisbatan qaysi strategiya qo‘llaniladi?", ["Qoniqtirilgan holda ushlab turish", "Doimiy xabardor qilib turish", "Yaqindan boshqarish", "Minimal kuzatib borish"], 1],
    ["Manfaatdor tomonlarni jalb qilish matritsasida “qarshilik ko‘rsatuvchi” tomon qanday tavsiflanadi?", ["Loyiha va uning ta’siridan xabardor, ammo o‘zgarishga qarshi", "Loyihadan xabardor va uning muvaffaqiyatini qo‘llab-quvvatlaydi", "Loyihadan xabardor, lekin na qo‘llaydi, na qarshilik qiladi", "Loyihadan ham, uning ta’siridan ham umuman xabardor emas"], 0],
    ["“Salience” (ahamiyatlilik) modeli manfaatdor tomonlarni qaysi uch belgi bo‘yicha tasniflaydi?", ["Lavozim, tajriba va mas’uliyat", "Vakolat, shoshilinchlik va qonuniylik", "Faollik, xabardorlik va qo‘llab-quvvatlash", "Qiziqish, ta’sir va moliyaviy hissa"], 1],
    ["Manfaatdor tomonlar talablarini yig‘ishda qaysi usul qo‘llaniladi?", ["Topilgan qiymat tahlili", "Kritik yo‘l usuli", "Resurslarni tekislash", "Intervyu va fokus-guruhlar"], 3],
    ["Manfaatdor tomonlarni rejalashtirish jarayoniga erta jalb etishning asosiy foydasi nimada?", ["Loyiha menejerining hisobot berish hajmi qisqaradi", "Loyiha homiysining tasdig‘iga ehtiyoj qolmaydi", "Loyiha jadvali va byudjeti qayta ko‘rib chiqilmaydi", "Talablar aniqlashib, o‘zgarishlar xavfi kamayadi"], 3],
    ["Manfaatdor tomonlarni jalb qilish rejasi nimani belgilaydi?", ["Loyiha byudjetining moddalar bo‘yicha taqsimotini", "Loyiha xavflarining ehtimolligi va ta’sir darajasini", "Har birini samarali jalb qilish strategiyasi va harakatlarini", "Loyiha ishlari ketma-ketligi va ularning davomiyligini"], 2],
    ["Manfaatdor tomonlarning qarama-qarshi talablarini hal qilishda asosiy mezon nima?", ["Loyiha maqsadlari va biznes asoslanishiga muvofiqlik", "Talab qilgan tomonning lavozimi va mavqei darajasi", "Talabni bajarish uchun ketadigan eng kam vaqt", "Talab birinchi bo‘lib kim tomonidan bildirilgani"], 0],
    ["SMART mezonidagi “S” harfi nimani anglatadi?", ["Strategic (strategik)", "Stable (barqaror)", "Specific (aniq)", "Simple (oddiy)"], 2],
    ["SMART mezonidagi “M” harfi nimani anglatadi?", ["Manageable (boshqariladigan)", "Measurable (o‘lchanadigan)", "Meaningful (mazmunli)", "Motivating (rag‘batlantiruvchi)"], 1],
    ["SMART mezonidagi “A” harfi nimani anglatadi?", ["Actual (dolzarb hisoblangan)", "Achievable (erishsa bo‘ladigan)", "Ambitious (yuksak etirof etilgan)", "Accurate (aniq hisoblangan)"], 1],
    ["SMART mezonidagi “T” harfi nimani anglatadi?", ["Targeted (yo‘naltirilgan)", "Technical (texnik jihatdan asoslangan)", "Time-bound (muddati belgilangan)", "Transparent (shaffof)"], 2],
    ["Quyidagi maqsadlardan qaysi biri SMART mezoniga eng mos keladi?", ["Ilovani foydalanuvchilar uchun imkon qadar qulay va mashhur qilish", "Ilova foydalanuvchilari sonini raqobatchilarnikidan ko‘proq qilish", "2026-yil dekabrgacha ilova foydalanuvchilarini 5000 taga yetkazish", "Yaqin kelajakda ilova foydalanuvchilari sonini sezilarli oshirish"], 2],
    ["Loyiha qarashi (vision) nimani ifodalaydi?", ["Loyiha byudjetining moddalar bo‘yicha batafsil taqsimotini", "Loyiha natijasida erishiladigan kelajakdagi istalgan holatni", "Loyiha ishlarining kunlik bajarilish tartibi va navbatini", "Jamoa a’zolari o‘rtasidagi vazifalar va rollar taqsimotini"], 1],
    ["Missiya va qarash (vision) o‘rtasidagi farq nimada?", ["Missiya moliyaviy, qarash esa texnik ko‘rsatkichlarni ifodalaydi", "Missiya hozirgi vazifani, qarash esa kelajakdagi holatni ifodalaydi", "Missiya ichki, qarash esa tashqi foydalanuvchilar uchun yoziladi", "Missiya kelajakdagi holatni, qarash esa hozirgi vazifani ifodalaydi"], 1],
    ["Loyiha maqsadi (goal) va vazifalari (objectives) o‘rtasidagi munosabat qanday?", ["Maqsad va vazifalar bir-biriga bog‘liq bo‘lmagan mustaqil tushunchalardir", "Vazifalar loyiha yakunida, maqsadlar esa loyiha boshida belgilanadi", "Maqsadlar vazifalarga erishish uchun aniq va o‘lchanadigan qadamlardir", "Vazifalar maqsadga erishish uchun aniq va o‘lchanadigan qadamlardir"], 3],
    ["Loyiha maqsadlarini aniq ifodalash nima uchun muhim?", ["Shartnoma tuzishdagi yuridik talablarni bajarish uchun zarur bo‘ladi", "Jamoa a’zolari sonini aniqlashning asosiy mezoni bo‘lib xizmat qiladi", "Loyiha byudjetini tasdiqlash jarayonini qisqartirishga xizmat qiladi", "Natijani baholash va jamoa harakatini yo‘naltirish uchun asos bo‘ladi"], 3],
    ["Loyihaning muvaffaqiyat mezonlari qachon belgilanishi kerak?", ["Bajarish bosqichining o‘rtasida, holatga qarab", "Loyiha yakunlangandan so‘ng, natijalarga qarab", "Mijoz natijani qabul qilayotgan paytda", "Loyiha boshlanishida, rejalashtirishdan oldin"], 3],
    ["Loyiha ustavida (charter) odatda nima ko‘rsatiladi?", ["Loyiha maqsadi, asosiy talablar, homiy va menejer vakolati", "Har bir ish paketining batafsil kalendar jadvali va muddati", "Bajarilgan ishlarning topilgan qiymat ko‘rsatkichlari", "Jamoa a’zolarining kundalik ish hisobotlari va natijalari"], 0],
    ["Loyiha xavfi (risk) deganda nima tushuniladi?", ["Loyiha jamoasi a’zolari o‘rtasida kelib chiqqan kelishmovchilik", "Yuz bersa loyiha maqsadlariga ta’sir qiladigan noaniq hodisa yoki holat", "Loyiha davomida allaqachon yuz bergan va hal qilinishi kerak muammo", "Mijoz tomonidan kiritilgan va tasdiqlangan o‘zgarish so‘rovi"], 1],
    ["Xavf darajasi (risk exposure) qanday aniqlanadi?", ["Ta’sir ÷ ehtimollik", "Ehtimollik × ta’sir", "Ehtimollik = ta’sir", "Ehtimollik − ta’sir"], 1],
    ["Xavf ehtimolligi 0,3, ta’siri 20 000 000 so‘m bo‘lsa, kutilayotgan pul qiymati (EMV) qancha?", ["2 000 000 so‘m", "6 000 000 so‘m", "60 000 000 so‘m", "600 000 so‘m"], 1],
    ["Salbiy xavfga javob strategiyasi sifatida “xavfni o‘tkazish” (transfer) nimani anglatadi?", ["Xavf oqibatlari mas’uliyatini uchinchi tomonga yuklash", "Xavf manbasini bartaraf etish uchun rejani o‘zgartirish", "Xavf ehtimolligi yoki ta’sirini kamaytirish choralarini ko‘rish", "Xavfni qabul qilib, yuz berganda chora ko‘rishga tayyor turish"], 0],
    ["“Xavfdan qochish” (avoid) strategiyasi nimani anglatadi?", ["Xavf oqibatlari mas’uliyatini sug‘urta kompaniyasiga yuklash", "Xavf tahdidini bartaraf etish uchun loyiha rejasini o‘zgartirish", "Xavf ta’sirini maqbul darajagacha pasaytirish choralarini ko‘rish", "Xavfni tan olib, faol chora ko‘rmasdan kuzatib borish"], 1],
    ["“Xavfni yumshatish” (mitigate) strategiyasi nimani anglatadi?", ["Xavfni qayd etib, yuz berganda zaxiradan foydalanish", "Xavf manbasini loyiha qamrovidan butunlay chiqarib tashlash", "Xavf mas’uliyatini shartnoma orqali pudratchiga o‘tkazish", "Xavf ehtimolligi yoki ta’sirini maqbul darajagacha kamaytirish"], 3],
    ["Ijobiy xavf (imkoniyat) uchun qaysi javob strategiyasi qo‘llaniladi?", ["Qochish (avoid)", "O‘tkazish (transfer)", "Yumshatish (mitigate)", "Foydalanish (exploit)"], 3],
    ["Xavflarni sifat tahlilida qaysi vosita keng qo‘llaniladi?", ["Monte-Karlo simulyatsiyasi", "Sezgirlik tahlili (tornado diagramma)", "Qaror daraxti tahlili", "Ehtimollik va ta’sir matritsasi"], 3],
    ["Xavflarni miqdoriy tahlil qilish usuli qaysi?", ["Ehtimollik va ta’sir matritsasi", "Monte-Karlo simulyatsiyasi", "Xavflarni toifalash tuzilmasi (RBS)", "Miya hujumi (brainstorming)"], 1],
    ["Delphi usuli xavflarni aniqlashda qanday qo‘llaniladi?", ["Jamoa a’zolari bir xonada ochiq muhokama o‘tkazadi", "Ekspertlardan anonim tarzda bir necha tur so‘rov o‘tkaziladi", "Avvalgi loyihalar hujjatlari statistik tahlil qilinadi", "Har bir xavfga ehtimollik va ta’sir bali beriladi"], 1],
    ["Xavflar reestrida (Risk Register) nima qayd etiladi?", ["Loyiha ishlari va ularning bajarilish muddatlari", "Aniqlangan xavflar, ularning tahlili va javob choralari", "Tasdiqlangan o‘zgarish so‘rovlari va ularning holati", "Loyiha jamoasi a’zolarining aloqa ma’lumotlari"], 1],
    ["n kishidan iborat jamoada aloqa kanallari soni qanday hisoblanadi?", ["2n − 1", "n² / 2", "n(n − 1) / 2", "n(n + 1) / 2"], 2],
    ["Loyiha jamoasi 8 kishidan iborat bo‘lsa, aloqa kanallari soni nechta bo‘ladi?", ["28", "36", "56", "16"], 0],
    ["Aloqa (kommunikatsiya) boshqaruvi rejasi nimani belgilaydi?", ["Loyiha xarajatlarining moddalar bo‘yicha taqsimotini", "Loyiha ishlarining ketma-ketligi va davomiyligini", "Kim, qanday ma’lumotni, qachon va qaysi usulda olishini", "Loyiha natijalarini qabul qilish mezonlari va tartibini"], 2],
    ["“Tortish” (pull) aloqa usuliga qaysi biri misol bo‘ladi?", ["Videokonferensiya orqali o‘tkazilgan jonli muhokama", "Belgilangan manzillarga yuborilgan elektron pochta xabarlari", "Intranet portaliga joylangan va kerak paytda olinadigan hujjatlar", "Jamoa a’zolari bilan o‘tkazilgan yuzma-yuz yig‘ilish"], 2],
    ["WBS qisqartmasi nimani anglatadi?", ["Work Breakdown Structure", "Work Budget Schedule", "Workflow Based Structure", "Work Balance System"], 0],
    ["Ishni taqsimlash tuzilmasi (WBS) nima?", ["Loyiha qamrovining ierarxik tarzda kichik qismlarga bo‘linishi", "Loyiha jamoasi a’zolarining lavozimlar bo‘yicha sxemasi", "Loyiha ishlarining vaqt shkalasidagi kalendar ko‘rinishi", "Loyiha xavflarining toifalar bo‘yicha guruhlanishi"], 0],
    ["WBS ning eng quyi darajasidagi element nima deb ataladi?", ["Kritik yo‘l (critical path)", "Nazorat hisobi (control account)", "Ish paketi (work package)", "Nazorat nuqtasi (milestone)"], 2],
    ["WBS uchun “100% qoidasi” nimani bildiradi?", ["WBS ning har bir darajasi yuzta elementdan oshmasligi kerakligi", "WBS qamrovdagi barcha ishlarni to‘liq va ortiqchasiz aks ettirishi", "Har bir ish paketi loyiha byudjetining yuz foizini tashkil etishi", "Loyiha ishlarining yuz foizi bitta jamoaga topshirilishi kerakligi"], 1],
    ["WBS lug‘ati (WBS Dictionary) nimani o‘z ichiga oladi?", ["Loyihada qo‘llanilgan atamalarning alifbo tartibidagi ro‘yxatini", "Loyiha hujjatlarining boshqa tillarga tarjima qilingan nusxalarini", "Har bir WBS elementining batafsil tavsifi va xususiyatlarini", "Jamoa a’zolarining kasbiy malakalari va tajribasi ro‘yxatini"], 2],
    ["Ish paketining hajmi bo‘yicha “8/80 qoidasi” nimani tavsiya etadi?", ["Ish paketining 80 foizi 8 kun ichida bajarilishi kerak", "WBS 8 darajadan va 80 ta elementdan oshmasligi kerak", "Ish paketi 8 soatdan kam va 80 soatdan ko‘p bo‘lmasligi kerak", "Ish paketida 8 dan 80 gacha xodim ishtirok etishi kerak"], 2],
    ["WBS tuzishda qaysi yondashuvdan foydalanish mumkin?", ["Natijalarga yoki bosqichlarga asoslangan yondashuv", "Xodimlarning ish haqi darajasiga asoslangan yondashuv", "Loyiha xavflarining ehtimolligiga asoslangan yondashuv", "Hujjatlarning yaratilgan sanasiga asoslangan yondashuv"], 0],
    ["WBS da ishlarni kichik qismlarga bo‘lish jarayoni nima deb ataladi?", ["Agregatsiya", "Dekompozitsiya", "Integratsiya", "Optimallashtirish"], 1],
    ["WBS qanday rejalashtirish ishlari uchun asos bo‘ladi?", ["Mijoz bilan tuziladigan shartnoma matni uchun", "Jamoa a’zolarining ish haqi vedomosti uchun", "Loyiha ustavi va biznes asoslanishini yozish uchun", "Jadval, byudjet va resurslarni rejalashtirish uchun"], 3],
    ["Scrum loyihalarida WBS o‘rniga ko‘pincha nimadan foydalaniladi?", ["Xavflar reestri (Risk Register)", "Mahsulot bekloggi (Product Backlog)", "O‘zgarishlar jurnali (Change Log)", "Loyiha ustavi (Project Charter)"], 1],
    ["WBS ni yaratishda kimlarning ishtirok etishi tavsiya etiladi?", ["Loyiha homiysi va yuridik bo‘lim vakillarining", "Jamoadan alohida holda loyiha menejerining o‘zining", "Tashqi auditor va moliyaviy bo‘lim xodimlarining", "Loyiha menejeri va ishni bajaruvchi jamoa a’zolarining"], 3],
    ["Ishlar ketma-ketligini aniqlashda qaysi usul qo‘llaniladi?", ["Ustunlik diagrammasi usuli", "SWOT tahlili usuli", "Monte-Karlo simulyatsiyasi usuli", "Topilgan qiymat usuli (EVM)"], 0],
    ["“Finish-to-Start” (FS) bog‘liqligi nimani bildiradi?", ["Oldingi ish boshlangach, keyingi ish boshlanishi mumkin", "Oldingi ish tugagach, keyingi ish boshlanishi mumkin", "Oldingi ish boshlangach, keyingi ish tugashi mumkin", "Oldingi ish tugagach, keyingi ish ham tugashi mumkin"], 1],
    ["“Start-to-Start” (SS) bog‘liqligi nimani bildiradi?", ["Oldingi ish tugagach, keyingi ish ham tugashi mumkin", "Oldingi ish boshlangach, keyingi ish tugashi mumkin", "Oldingi ish tugagach, keyingi ish boshlanishi mumkin", "Oldingi ish boshlangach, keyingi ish boshlanishi mumkin"], 3],
    ["“Lag” (kechikish) tushunchasi nimani anglatadi?", ["Keyingi ishni oldinroq boshlash uchun qisqartirilgan vaqt", "Kritik yo‘ldagi barcha ishlarning umumiy davomiyligi", "Keyingi ish boshlanishidan oldin qo‘shiladigan kutish vaqti", "Ishning loyiha muddatiga ta’sir qilmay surilish vaqti"], 2],
    ["“Lead” (ilgarilash) tushunchasi nimani anglatadi?", ["Loyihadagi eng uzun ishlar zanjirining umumiy davomiyligi", "Ishning loyiha muddatiga ta’sir qilmay surilishi mumkin vaqt", "Keyingi ish boshlanishidan oldin qo‘shiladigan kutish vaqti", "Keyingi ishni oldingisi tugashidan oldinroq boshlash imkoniyati"], 3],
    ["Majburiy bog‘liqlikka (mandatory dependency) qaysi biri misol bo‘ladi?", ["Menejer qaroriga ko‘ra ishlar navbat bilan bajarilishi", "Jamoa an’anasiga ko‘ra dizayndan keyin test yozilishi", "Mijoz istagiga ko‘ra hujjatlar oxirida tayyorlanishi", "Ma’lumotlar bazasi yaratilmasdan unga so‘rov yozib bo‘lmasligi"], 3],
    ["Ixtiyoriy (discretionary) bog‘liqlik nimaga asoslanadi?", ["Ishning fizik yoki texnik tabiatidan kelib chiqadigan zaruriyatga", "Eng yaxshi amaliyot yoki jamoa tajribasiga ko‘ra tanlangan tartibga", "Loyiha ustavida homiy tomonidan belgilangan qat’iy tartibga", "Loyihadan tashqaridagi tomonlar ishiga bog‘liq bo‘lgan tartibga"], 1],
    ["Tashqi bog‘liqlik (external dependency) nima?", ["Ishning texnik tabiatidan kelib chiqadigan majburiy tartib", "Loyiha ishlari va loyihadan tashqari faoliyatlar o‘rtasidagi bog‘liqlik", "Bir jamoa ichidagi ikki ish paketi o‘rtasidagi texnik bog‘liqlik", "Jamoa tajribasiga asoslanib tanlangan ixtiyoriy ketma-ketlik"], 1],
    ["Resurslarni tekislash (resource leveling) nima maqsadda qo‘llaniladi?", ["Loyiha byudjetini moddalar bo‘yicha qayta taqsimlash", "Resurslarning ortiqcha yuklanishini bartaraf etib, ularni muvozanatlash", "Loyiha muddatini qo‘shimcha resurs jalb qilish orqali qisqartirish", "Ishlarni parallel bajarish hisobiga jadvalni tezlashtirish"], 1],
    ["RACI matritsasidagi “A” harfi nimani anglatadi?", ["Assisting (yordamchi)", "Approved (tasdiqlangan)", "Assigned (tayinlangan)", "Accountable (yakuniy javobgar)"], 3],
    ["RACI matritsasida “R” (Responsible) roli kimga beriladi?", ["Ish uchun yakuniy javob beruvchi shaxsga", "Ish yuzasidan maslahat so‘raladigan shaxsga", "Ishni bevosita bajaruvchi shaxsga", "Ish natijasidan xabardor qilinadigan shaxsga"], 2],
    ["RACI matritsasida bitta ish uchun nechta “A” (Accountable) belgilanishi kerak?", ["Kamida ikki shaxs", "Har bir a’zo uchun bittadan", "Cheklanmagan miqdorda", "Faqat bitta shaxs"], 3],
    ["Kritik yo‘l deganda nima tushuniladi?", ["Loyiha davomiyligini belgilovchi eng qisqa ishlar ketma-ketligi", "Eng yuqori xavfga ega bo‘lgan ishlar ketma-ketligi", "Loyiha davomiyligini belgilovchi eng uzun ishlar ketma-ketligi", "Eng ko‘p resurs talab qiladigan ishlar ketma-ketligi"], 2],
    ["Kritik yo‘ldagi ishlarning umumiy zaxira vaqti (total float) odatda nechaga teng?", ["Nolga", "Eng uzun ish davomiyligiga", "Birga", "Loyiha muddatiga"], 0],
    ["Ishning umumiy zaxira vaqti (total float) qanday hisoblanadi?", ["LF − ES (yoki LS − EF)", "EF + LF (yoki ES + LS)", "ES − EF (yoki LS − LF)", "LS − ES (yoki LF − EF)"], 3],
    ["Ishlar: A (3 kun), B (5 kun, A dan keyin), C (4 kun, A dan keyin), D (2 kun, B va C dan keyin). Loyiha davomiyligi necha kun?", ["10 kun", "8 kun", "14 kun", "9 kun"], 0],
    ["Ishlar: A (2 kun), B (4 kun, A dan keyin), C (6 kun, A dan keyin), D (3 kun, B dan keyin), E (1 kun, C va D dan keyin). Kritik yo‘l qaysi?", ["A – C – E", "A – B – D – E", "A – C – D – E", "A – B – E"], 1],
    ["Ishlar: A (2 kun), B (4 kun, A dan keyin), C (6 kun, A dan keyin), D (3 kun, B dan keyin), E (1 kun, C va D dan keyin). C ishining zaxira vaqti necha kun?", ["1 kun", "0 kun", "3 kun", "2 kun"], 0],
    ["Gantt diagrammasi nimani tasvirlaydi?", ["Ishlarning vaqt shkalasida boshlanish va tugash muddatlarini", "Xavflarning ehtimolligi va ta’sir darajasini", "Loyiha qamrovining ierarxik tuzilishi va darajalarini", "Jamoa a’zolarining rollari va javobgarliklarini"], 0],
    ["Jadvalni siqishning “crashing” usuli nima?", ["Loyiha qamrovidan ayrim ishlarni chiqarib tashlash", "Ketma-ket ishlarni parallel bajarib, jadvalni qisqartirish", "Resurslar yuklamasini muvozanatlab, ortiqcha yukni bartaraf etish", "Qo‘shimcha resurs jalb qilib, kritik ishlar davomiyligini qisqartirish"], 3],
    ["Jadvalni siqishning “fast tracking” usuli nima?", ["Loyiha qamrovidan ayrim ishlarni chiqarib tashlash", "Resurslar yuklamasini muvozanatlab, ortiqcha yukni bartaraf etish", "Kritik ishlarga qo‘shimcha resurs jalb qilib, davomiylikni qisqartirish", "Ketma-ket rejalashtirilgan ishlarni qisman parallel bajarish"], 3],
    ["“Fast tracking” usulining asosiy kamchiligi nimada?", ["Resurslarga bo‘lgan xarajatlar sezilarli oshadi", "Qayta ishlash (rework) va xavf darajasi ortadi", "Jamoa tarkibini o‘zgartirish talab etiladi", "Loyiha qamrovini qisqartirishga olib keladi"], 1],
    ["Nazorat nuqtasining (milestone) davomiyligi qancha bo‘ladi?", ["Nolga teng", "Bosqich davomiyligiga teng", "Bir kunga teng", "Bir haftaga teng"], 0],
    ["Jadvalda ES (Early Start) nimani anglatadi?", ["Ishning eng kech tugash vaqtini", "Ishning eng kech boshlanish vaqtini", "Ishning eng erta tugash vaqtini", "Ishning eng erta boshlanish vaqtini"], 3],
    ["To‘g‘ri yurish (forward pass) natijasida nima aniqlanadi?", ["Ishlarning haqiqatda bajarilganlik foizi", "Ishlarning eng erta boshlanish va tugash vaqtlari", "Ishlarning resurslar bilan ta’minlanganlik darajasi", "Ishlarning eng kech boshlanish va tugash vaqtlari"], 1],
    ["Loyiha monitoringining asosiy maqsadi nima?", ["Loyiha rejasini dastlabki bosqichda batafsil ishlab chiqish", "Loyiha jamoasi a’zolarini tanlash, yollash va o‘qitish", "Loyiha natijalarini mijozga rasman topshirib berish", "Haqiqiy natijalarni rejaga solishtirib, chetlanishlarni aniqlash"], 3],
    ["KPI qisqartmasi nimani anglatadi?", ["Key Project Information", "Key Process Improvement", "Key Planning Instrument", "Key Performance Indicator"], 3],
    ["Loyihani nazorat qilishda chetlanish tahlili (variance analysis) nima?", ["Rejalashtirilgan va haqiqiy ko‘rsatkichlar farqini tahlil qilish", "Xavflar ehtimolligi va ta’sir darajasini tahlil qilish", "Ishlar ketma-ketligi va bog‘liqliklarini tahlil qilish", "Manfaatdor tomonlar ta’siri va qiziqishini tahlil qilish"], 0],
    ["Tuzatuvchi harakat (corrective action) nima?", ["Mahsulotning nuqsonli qismini tuzatish uchun ko‘rilgan chora", "Loyiha qamrovini kengaytirish maqsadida ko‘rilgan chora", "Kelgusida chetlanish yuz bermasligi uchun oldindan ko‘rilgan chora", "Loyiha ishini rejaga qayta muvofiqlashtirish uchun ko‘rilgan chora"], 3],
    ["Oldini oluvchi harakat (preventive action) nima?", ["Kelgusida chetlanish yuz bermasligi uchun oldindan ko‘rilgan chora", "Loyiha qamrovini kengaytirish maqsadida ko‘rilgan chora", "Loyiha ishini rejaga qayta muvofiqlashtirish uchun ko‘rilgan chora", "Mahsulotning nuqsonli qismini tuzatish uchun ko‘rilgan chora"], 0],
    ["Loyiha holati hisobotida (status report) odatda nima aks ettiriladi?", ["Jamoa a’zolarining shaxsiy ma’lumotlari va ish haqi", "Loyiha ustavining asl matni va homiyning imzosi", "Joriy holat, bajarilgan ishlar, muammolar va keyingi qadamlar", "Mijoz bilan tuzilgan shartnomaning yuridik shartlari"], 2],
    ["“Svetofor” (RAG) holat ko‘rsatkichida qizil rang nimani bildiradi?", ["Loyiha ishlari rejali tarzda vaqtincha to‘xtatilgan", "Kichik chetlanish bor, uni kuzatib borish kifoya", "Jiddiy muammo bor, zudlik bilan aralashuv talab etiladi", "Loyiha reja bo‘yicha muvaffaqiyatli davom etmoqda"], 2],
    ["Sifatni nazorat qilishda Pareto tahlili qaysi tamoyilga asoslanadi?", ["Muammolarning 90% i sabablarning 10% idan kelib chiqadi", "Muammolarning 50% i sabablarning 50% idan kelib chiqadi", "Muammolarning 20% i sabablarning 80% idan kelib chiqadi", "Muammolarning 80% i sabablarning 20% idan kelib chiqadi"], 3],
    ["Isikava (baliq skeleti) diagrammasi nima uchun ishlatiladi?", ["Loyiha ishlarining vaqt jadvalini tuzish uchun", "Jamoa a’zolarining rollarini taqsimlash uchun", "Muammoning ildiz sabablarini aniqlash uchun", "Xarajatlar dinamikasini kuzatib borish uchun"], 2],
    ["Nazorat diagrammasi (control chart) nimani aniqlashga yordam beradi?", ["Manfaatdor tomonlarning ta’sir va qiziqish darajasini", "Loyiha ishlari o‘rtasidagi mantiqiy bog‘liqliklarni", "Loyiha qamrovining ierarxik tuzilishi va darajalarini", "Jarayon barqarorligi va belgilangan chegaralardan chiqishni"], 3],
    ["Deming sikli (PDCA) bosqichlari qaysi?", ["Rejalashtirish – bajarish – tekshirish – harakat qilish", "Boshlash – rejalashtirish – bajarish – yakunlash", "Tahlil – loyihalash – ishlab chiqish – joriy etish", "Aniqlash – o‘lchash – tahlil qilish – yaxshilash"], 0],
    ["O‘zgarishlarni boshqarish jarayonining asosiy maqsadi nima?", ["Loyiha davomida har qanday o‘zgarish kiritilishini taqiqlash", "Barcha o‘zgarishlarni loyiha yakunida bir yo‘la kiritish", "O‘zgarishlarni nazoratli ko‘rib chiqish, tasdiqlash yoki rad etish", "Mijoz so‘ragan barcha o‘zgarishlarni zudlik bilan joriy etish"], 2],
    ["O‘zgarish so‘rovlarini ko‘rib chiqib qaror qabul qiluvchi organ qanday ataladi?", ["Texnik qo‘llab-quvvatlash xizmati (Support)", "O‘zgarishlarni nazorat qilish kengashi (CCB)", "Sifatni ta’minlash guruhi (QA)", "Loyiha boshqaruv ofisi (PMO)"], 1],
    ["“Qamrovning sirpanishi” (scope creep) nima?", ["Qamrovning rasmiy tasdiqlanmagan holda nazoratsiz kengayishi", "Loyiha byudjetining rejadagidan kam sarflanishi", "Qamrovning rasmiy tasdiq asosida rejali ravishda kengaytirilishi", "Loyiha muddatining qo‘shimcha resurs hisobiga qisqarishi"], 0],
    ["“Gold plating” (oltin bilan qoplash) nima?", ["Mijoz tomonidan rasmiy so‘rov orqali yangi talab kiritilishi", "Loyiha byudjetiga qo‘shimcha zaxira mablag‘ ajratilishi", "Sifatni oshirish uchun tasdiqlangan qo‘shimcha test o‘tkazilishi", "Jamoa tomonidan so‘ralmagan qo‘shimcha funksiyalar qo‘shilishi"], 3],
    ["O‘zgarish so‘rovini ko‘rib chiqishda birinchi navbatda nima qilinadi?", ["O‘zgarish jamoa a’zolarining ovozi bilan tasdiqlanadi", "O‘zgarishning loyiha cheklovlariga ta’siri baholanadi", "O‘zgarish mijozga xabar berilmasdan rad etiladi", "O‘zgarish darhol joriy etilib, keyin hujjatlashtiriladi"], 1],
    ["Integrallashgan o‘zgarishlarni nazorat qilish jarayoni qaysi jarayonlar guruhiga kiradi?", ["Yakunlash (closing)", "Monitoring va nazorat (controlling)", "Bajarish (executing)", "Rejalashtirish (planning)"], 1],
    ["O‘zgarishlar jurnalida (Change Log) nima qayd etiladi?", ["Barcha o‘zgarish so‘rovlari va ularning holati", "Loyiha jamoasi a’zolarining ish soatlari", "Aniqlangan xavflar va ularga javob choralari", "Natijalarni qabul qilish dalolatnomalari"], 0],
    ["Kotter modeliga ko‘ra tashkiliy o‘zgarishning birinchi bosqichi qaysi?", ["Shoshilinchlik hissini yaratish", "O‘zgarish qarashini keng tarqatish", "O‘zgarishni tashkiliy madaniyatga singdirish", "Qisqa muddatli g‘alabalarni yaratish"], 0],
    ["Levin modelidagi o‘zgarish bosqichlari qaysi?", ["Xabardorlik – istak – bilim – qobiliyat – mustahkamlash", "Rejalashtirish – bajarish – tekshirish – harakat qilish", "Muzdan tushirish – o‘zgartirish – qayta muzlatish", "Shakllanish – to‘qnashuv – me’yorlanish – samarali ishlash"], 2],
    ["Agile loyihalarda talablardagi o‘zgarishlarga munosabat qanday?", ["Kech bosqichda ham qabul qilinib, backlogga kiritiladi", "Joriy sprint davomida darhol kodga kiritiladi", "Loyiha boshlangandan keyin umuman qabul qilinmaydi", "Yangi shartnoma tuzilgandan keyingina ko‘rib chiqiladi"], 0],
    ["Tasdiqlangan o‘zgarishdan keyin nima qilinishi kerak?", ["Loyiha rejasi va bazaviy ko‘rsatkichlar yangilanadi", "Loyiha ustavi bekor qilinib, yangi loyiha ochiladi", "Loyiha jamoasining tarkibi to‘liq almashtiriladi", "Avvalgi bazaviy reja o‘zgarishsiz saqlab qolinadi"], 0],
    ["Topilgan qiymat tahlilida PV nimani anglatadi?", ["Bajarilgan ish uchun haqiqatda sarflangan xarajat", "Loyihani yakunlash uchun zarur prognoz xarajat", "Rejalashtirilgan ishning byudjetdagi qiymati", "Haqiqatda bajarilgan ishning byudjetdagi qiymati"], 2],
    ["Topilgan qiymat tahlilida EV nimani anglatadi?", ["Bajarilgan ish uchun haqiqatda sarflangan xarajat", "Haqiqatda bajarilgan ishning byudjetdagi qiymati", "Loyihani yakunlash uchun zarur prognoz xarajat", "Rejalashtirilgan ishning byudjetdagi qiymati"], 1],
    ["Topilgan qiymat tahlilida AC nimani anglatadi?", ["Bajarilgan ish uchun haqiqatda sarflangan xarajat", "Rejalashtirilgan ishning byudjetdagi qiymati", "Loyihani yakunlash uchun zarur prognoz xarajat", "Haqiqatda bajarilgan ishning byudjetdagi qiymati"], 0],
    ["Xarajat samaradorligi indeksi (CPI) qanday hisoblanadi?", ["CPI = AC / EV", "CPI = PV / AC", "CPI = EV / PV", "CPI = EV / AC"], 3],
    ["Jadval samaradorligi indeksi (SPI) qanday hisoblanadi?", ["SPI = AC / PV", "SPI = EV / AC", "SPI = PV / EV", "SPI = EV / PV"], 3],
    ["Xarajat chetlanishi (CV) qanday hisoblanadi?", ["CV = AC − EV", "CV = PV − AC", "CV = EV − AC", "CV = EV − PV"], 2],
    ["Jadval chetlanishi (SV) qanday hisoblanadi?", ["SV = PV − EV", "SV = AC − PV", "SV = EV − AC", "SV = EV − PV"], 3],
    ["CPI < 1 bo‘lsa, bu nimani bildiradi?", ["Loyiha byudjetni tejab bormoqda", "Loyiha byudjetdan oshib ketmoqda", "Loyiha jadvaldan oldinda bormoqda", "Loyiha jadvaldan orqada qolmoqda"], 1],
    ["EV = 40 mln so‘m, AC = 50 mln so‘m bo‘lsa, CPI nechaga teng?", ["0,2", "0,8", "1,25", "1,8"], 1],
    ["EV = 60 mln so‘m, PV = 80 mln so‘m bo‘lsa, SPI nechaga teng?", ["1,33", "0,25", "1,20", "0,75"], 3],
    ["PV = 100 mln so‘m, EV = 90 mln so‘m, AC = 110 mln so‘m bo‘lsa, xarajat chetlanishi (CV) qancha?", ["−20 mln so‘m", "20 mln so‘m", "−10 mln so‘m", "10 mln so‘m"], 0],
    ["PV = 100 mln so‘m, EV = 90 mln so‘m, AC = 110 mln so‘m bo‘lsa, jadval chetlanishi (SV) qancha?", ["−20 mln so‘m", "20 mln so‘m", "−10 mln so‘m", "10 mln so‘m"], 2],
    ["Topilgan qiymat tahlilida BAC nimani anglatadi?", ["Yakunlashdagi umumiy byudjet", "Yakunlash uchun qolgan xarajat", "Yakunlashdagi xarajat chetlanishi", "Yakunlashdagi prognoz xarajat"], 0],
    ["CPI o‘zgarmaydi deb faraz qilinsa, yakunlashdagi prognoz xarajat (EAC) qanday hisoblanadi?", ["EAC = BAC / SPI", "EAC = BAC / CPI", "EAC = BAC × CPI", "EAC = AC / CPI"], 1],
    ["BAC = 200 mln so‘m, CPI = 0,8 bo‘lsa, EAC = BAC / CPI formulasi bo‘yicha prognoz xarajat qancha?", ["160 mln so‘m", "200 mln so‘m", "250 mln so‘m", "240 mln so‘m"], 2],
    ["TCPI ko‘rsatkichi nimani ifodalaydi?", ["Qolgan ishni byudjetda bajarish uchun zarur xarajat samaradorligini", "Loyiha yakunida kutilayotgan umumiy xarajat miqdorini", "Bajarilgan ishning rejalashtirilgan ishga bo‘lgan nisbatini", "Yakunlashdagi byudjet va prognoz xarajat o‘rtasidagi farqni"], 0],
    ["Takman modeliga ko‘ra jamoa rivojlanishining to‘g‘ri ketma-ketligi qaysi?", ["Me’yorlanish – shakllanish – to‘qnashuv – samarali ishlash", "Shakllanish – to‘qnashuv – me’yorlanish – samarali ishlash", "To‘qnashuv – shakllanish – samarali ishlash – me’yorlanish", "Shakllanish – me’yorlanish – to‘qnashuv – samarali ishlash"], 1],
    ["Takman modelida “to‘qnashuv” (storming) bosqichi nima bilan tavsiflanadi?", ["Jamoaning umumiy qoidalar va o‘zaro ishonchni shakllantirishi", "Fikrlar va ish uslublari o‘rtasida kelishmovchiliklar paydo bo‘lishi", "Jamoaning mustaqil va yuqori samaradorlik bilan ishlashi", "Jamoa a’zolarining endi tanishib, ehtiyotkor harakat qilishi"], 1],
    ["Maslou ehtiyojlar ierarxiyasining eng yuqori pog‘onasi qaysi?", ["Xavfsizlik ehtiyoji", "Ijtimoiy mansublik ehtiyoji", "O‘zini namoyon etish ehtiyoji", "Hurmat va e’tirof ehtiyoji"], 2],
    ["Gersbergning ikki omilli nazariyasida “gigiyenik omil”ga qaysi biri misol bo‘ladi?", ["Mas’uliyat va kasbiy o‘sish", "Ishning mazmuni va qiziqarliligi", "Yutuq va e’tirof etilish", "Ish haqi va mehnat sharoitlari"], 3],
    ["Makgregorning “Y nazariyasi” xodimlarga qanday qaraydi?", ["Ular aniq ko‘rsatma bo‘lmasa mustaqil qaror qabul qila olmaydi", "Ular ishga ijodiy yondashadi va mas’uliyatni o‘z zimmasiga oladi", "Ular ishdan qochishga moyil bo‘lib, qat’iy nazoratga muhtoj", "Ular asosan moddiy rag‘bat evazigagina samarali ishlaydi"], 1],
    ["Nizolarni hal qilishning “g‘alaba – g‘alaba” natijasini beruvchi usuli qaysi?", ["Silliqlash (kelishmovchilikni yumshatish)", "Hamkorlik (muammoni birgalikda hal qilish)", "Majburlash (o‘z fikrini o‘tkazish)", "Murosa (o‘zaro yon berish)"], 1],
    ["Nizolarni hal qilishda “murosa” usulining xususiyati nimada?", ["Tomonlar muammodan vaqtincha chetlashib turadi", "Tomonlar umumiy yechim topib, to‘liq qoniqadi", "Har ikki tomon qisman qoniqish uchun yon beradi", "Bir tomon o‘z fikrini boshqasiga majburan o‘tkazadi"], 2],
    ["Jamoa ustavi (team charter) nimani belgilaydi?", ["Jamoa a’zolarining ish haqi va mukofot miqdorini", "Loyiha ishlarining kalendar jadvali va muddatlarini", "Jamoaning qadriyatlari, kelishuvlari va ish qoidalarini", "Loyiha xavflari va ularga javob choralarini"], 2],
    ["Virtual jamoalar bilan ishlashning asosiy qiyinchiligi nimada?", ["Muloqot va muvofiqlashtirishning murakkablashuvi", "Jamoa a’zolari sonining qat’iy cheklanib qolishi", "Ofis ijarasi xarajatlarining keskin oshib ketishi", "Loyiha hujjatlarini yuritish zaruratining yo‘qolishi"], 0],
    ["Xodimlarni baholashda “galo effekti” qanday xatoga olib keladi?", ["Barcha xodimlarni o‘rtacha baho bilan bir xilda baholash", "Xodimning faqat oxirgi natijasiga qarab butun faoliyatini baholash", "Xodimlarni ish stajiga qarab bir xil darajada baholash", "Bir sohadagi yutuqqa qarab xodimni boshqa sohalarda ham yuqori baholash"], 3],
    ["Jamoa a’zolarini rag‘batlantirishning nomoddiy usuliga qaysi biri misol bo‘ladi?", ["Oylik ish haqini muntazam oshirib borish", "Choraklik pul mukofotini to‘lab berish", "Ochiq e’tirof va minnatdorchilik bildirish", "Loyiha yakunida moliyaviy bonus berish"], 2],
    ["Scrum Guide (2020) bo‘yicha Scrum jamoasining tavsiya etilgan hajmi qancha?", ["Odatda 10 kishidan oshmasligi", "Kamida 15 kishidan iborat bo‘lishi", "20 dan 30 kishigacha bo‘lishi", "Aniq 3 kishidan iborat bo‘lishi"], 0],
    ["Rahbarlik (leadership) va menejment o‘rtasidagi asosiy farq nimada?", ["Rahbarlik jarayonlarni tartibga soladi, menejment odamlarni ilhomlantiradi", "Rahbarlik va menejment mazmunan bir-biridan farq qilmaydi", "Rahbarlik odamlarni ilhomlantiradi, menejment jarayonlarni tartibga soladi", "Rahbarlik moliyaga, menejment esa texnologiyaga qaratilgan bo‘ladi"], 2],
    ["French va Raven tasnifiga ko‘ra “ekspert hokimiyati” nimaga asoslanadi?", ["Jazo qo‘llash imkoniyatiga", "Mukofot berish imkoniyatiga", "Shaxsning rasmiy lavozimiga", "Shaxsning bilim va malakasiga"], 3],
    ["French va Raven tasnifiga ko‘ra “referent hokimiyat” nimaga asoslanadi?", ["Shaxsning tashkilotdagi rasmiy lavozimi va vakolatiga", "Shaxsga bo‘lgan hurmat va unga o‘xshashga intilishga", "Shaxsning chuqur kasbiy bilim va malakasiga", "Shaxsning mukofot va imtiyoz berish imkoniyatiga"], 1],
    ["French va Raven tasnifiga ko‘ra “qonuniy (legitimate) hokimiyat” nimaga asoslanadi?", ["Tashkilotdagi rasmiy lavozim va vakolatga", "Mukofot va imtiyoz berish imkoniyatiga", "Chuqur kasbiy bilim va malakaga", "Shaxsga bo‘lgan hurmat va xayrixohlikka"], 0],
    ["Transformatsion rahbarlik uslubining mohiyati nimada?", ["Jamoani umumiy qarash asosida ilhomlantirib, o‘zgarishga yetaklash", "Belgilangan qoida va tartiblarga qat’iy rioya qilinishini talab qilish", "Xodimlarni mukofot va jazo almashinuvi orqali boshqarib borish", "Qaror qabul qilishni to‘liq jamoaning o‘ziga topshirib qo‘yish"], 0],
    ["Tranzaksion rahbarlik uslubining mohiyati nimada?", ["Qaror qabul qilishni to‘liq jamoaning o‘ziga topshirib qo‘yish", "Xodimlarni natija evaziga mukofot va jazo tizimi orqali boshqarish", "Jamoani umumiy qarash asosida ilhomlantirib, o‘zgarishga yetaklash", "Jamoa ehtiyojlarini birinchi o‘ringa qo‘yib, unga xizmat qilish"], 1],
    ["“Laissez-faire” rahbarlik uslubi qanday tavsiflanadi?", ["Rahbar jamoa bilan maslahatlashib qaror qabul qiladi", "Rahbar jamoaga to‘liq erkinlik berib, ishga aralashmaydi", "Rahbar jamoa ehtiyojlariga xizmat qilishni ustun qo‘yadi", "Rahbar barcha qarorlarni yakka o‘zi qabul qiladi"], 1],
    ["D. Goulman modeliga ko‘ra emotsional intellekt tarkibiga qaysi komponent kiradi?", ["O‘zini anglash (self-awareness)", "Uzoq muddatli xotira hajmi", "Mantiqiy-matematik fikrlash", "Texnik-kasbiy malaka"], 0],
    ["Vaziyatli rahbarlik modeli (Hersey–Blanchard) bo‘yicha rahbarlik uslubi nimaga qarab tanlanadi?", ["Tashkilotning yillik daromadi hajmiga", "Loyihaning geografik joylashuviga", "Xodimlarning yetuklik va tayyorgarlik darajasiga", "Rahbarning shaxsiy fe’l-atvoriga"], 2],
    ["Guruhda qaror qabul qilishda “konsensus” nimani anglatadi?", ["Ko‘pchilik ovozi bilan qaror qabul qilish", "Barcha a’zolar qo‘llab-quvvatlay oladigan umumiy kelishuvga erishish", "Rahbarning yakka o‘zi qaror qabul qilishi", "Ekspertlarning anonim fikrlari asosida qaror qabul qilish"], 1],
    ["Vakolatni topshirish (delegatsiya) ning asosiy foydasi nimada?", ["Jamoa a’zolari rivojlanadi va menejer vaqti tejaladi", "Hisobot va nazorat jarayonlariga ehtiyoj qisqaradi", "Menejerning loyiha natijasi uchun javobgarligi kamayadi", "Loyiha byudjeti rejadagidan tezroq o‘zlashtiriladi"], 0],
    ["Loyihani yopish jarayonlari guruhining asosiy maqsadi nima?", ["Loyiha natijalarini rejaga solishtirib, nazorat qilib borish", "Loyiha ishlarining rejaga muvofiq bajarilishini ta’minlash", "Loyiha ustavini ishlab chiqib, loyiha menejerini tayinlash", "Barcha ishlarni rasman yakunlab, loyiha yoki bosqichni yopish"], 3],
    ["O‘rganilgan saboqlar (lessons learned) nima uchun hujjatlashtiriladi?", ["Loyiha byudjetini qayta tasdiqlatish uchun", "Kelgusi loyihalarda to‘plangan tajribadan foydalanish uchun", "Jamoa a’zolarining ish haqini qayta hisoblash uchun", "Mijoz bilan yangi shartnoma tuzish uchun"], 1],
    ["Qabul qilish mezonlari (acceptance criteria) nimani belgilaydi?", ["O‘zgarish so‘rovlarini ko‘rib chiqish muddatlari va tartibini", "Loyiha jamoasiga yangi xodimlarni qabul qilish talablarini", "Natija qabul qilinishi uchun bajarilishi lozim bo‘lgan shartlarni", "Loyiha xavflarini reestrga kiritish tartibi va qoidalarini"], 2],
    ["Loyiha natijasini topshirish-qabul qilish rasman qaysi hujjat bilan tasdiqlanadi?", ["Xavflar reestri hujjati", "Qabul qilish dalolatnomasi", "Texnik topshiriq (TZ)", "Loyiha ustavi (charter)"], 1],
    ["Loyiha yopilganda jamoa resurslari bilan nima qilinadi?", ["Rasman bo‘shatilib, boshqa vazifalarga o‘tkaziladi", "Mijoz tashkilotiga doimiy ishga o‘tkaziladi", "Keyingi loyiha boshlanguncha loyihada saqlab turiladi", "Loyiha homiysi ixtiyoriga doimiy ravishda beriladi"], 0],
    ["Loyiha muddatidan oldin to‘xtatilganda (terminated) yopish jarayoni bajariladimi?", ["Yo‘q, bunday loyiha hech qanday tartibsiz arxivga topshiriladi", "Ha, bajarilgan ishlar va to‘xtatish sabablari hujjatlashtiriladi", "Yo‘q, to‘xtatilgan loyiha uchun yopish jarayoni o‘tkazilmaydi", "Ha, ammo bunda hech qanday hujjatlashtirish talab etilmaydi"], 1],
    ["Loyihaning yakuniy hisobotida nima aks ettiriladi?", ["Maqsadlarga erishilganlik, xarajat, muddat va sifat natijalari", "Loyiha boshlanishidagi g‘oya va dastlabki taxminlar ro‘yxati", "Keyingi loyiha uchun tuzilgan batafsil ish jadvali", "Jamoa a’zolarining shaxsiy fikrlari va taassurotlari"], 0],
    ["Shartnomalarni yopish (procurement closure) nimani o‘z ichiga oladi?", ["Yetkazib beruvchilar bilan uzoq muddatli shartnoma tuzishni", "Yetkazib beruvchilarni tanlash uchun tender e’lon qilishni", "Yetkazib beruvchilar bilan majburiyatlarni yakuniy tasdiqlashni", "Yetkazib beruvchilarga qo‘shimcha yangi buyurtma berishni"], 2],
    ["Loyiha hujjatlarini arxivlashning maqsadi nima?", ["Tarixiy ma’lumotlarni kelgusi loyihalar va audit uchun saqlash", "Loyiha byudjetidagi qoldiqni hisobdan chiqarish", "Jamoa a’zolarining ish soatlarini qayta hisoblash", "Hujjatlarni keyingi loyihada qayta tasdiqlatib olish"], 0],
    ["Loyiha natijasini operatsion faoliyatga topshirish (transition) nimani anglatadi?", ["Loyiha rejasini va hujjatlarini yangi menejerga topshirish", "Loyiha jamoasini to‘liq tarkibda boshqa loyihaga o‘tkazish", "Natijani foydalanish va qo‘llab-quvvatlash uchun doimiy bo‘linmaga uzatish", "Loyihaning foydalanilmagan byudjetini keyingi yilga ko‘chirish"], 2],
    ["Loyihadan keyingi baholash (post-implementation review) qachon o‘tkaziladi?", ["Rejalashtirish bosqichi yakunlanayotgan paytda", "Bajarish bosqichi boshlanishidan oldin", "Natija foydalanishga topshirilgandan bir muncha vaqt o‘tib", "Loyiha ustavi imzolangan kunning o‘zida"], 2],
    ["SDLC qisqartmasi nimani anglatadi?", ["Structured Data Lifecycle Concept", "System Design and Logic Control", "Software Development Life Cycle", "Software Deployment and Load Control"], 2],
    ["Dasturiy ta’minot hayotiy sikli (SDLC) bosqichlarining to‘g‘ri ketma-ketligi qaysi?", ["Talablar tahlili – loyihalash – kodlash – testlash – joriy etish", "Kodlash – testlash – loyihalash – talablar tahlili – joriy etish", "Loyihalash – kodlash – talablar tahlili – joriy etish – testlash", "Talablar tahlili – kodlash – joriy etish – loyihalash – testlash"], 0],
    ["Dasturiy ta’minot ishlab chiqishning spiral modeli qanday xususiyatga ega?", ["Bosqichlar ortga qaytishsiz qat’iy ketma-ketlikda bajariladi", "Mahsulot hujjatlarsiz, faqat tezkor prototiplar bilan yaratiladi", "Har bir siklda xavflar tahlili bilan iterativ ishlab chiqiladi", "Har bir ishlab chiqish bosqichiga mos test bosqichi qo‘yiladi"], 2],
    ["Texnik topshiriq (TZ) nima?", ["Loyiha yakunida tuziladigan moliyaviy hisobot hujjati", "Tizimga qo‘yiladigan talablar va ishlab chiqish shartlari hujjati", "Dastur kodining izohlar bilan berilgan to‘liq matni", "Tayyor dasturdan foydalanish bo‘yicha foydalanuvchi qo‘llanmasi"], 1],
    ["Quyidagilardan qaysi biri funksional talabga misol bo‘ladi?", ["Ma’lumotlar shifrlangan holda saqlanishi kerak", "Foydalanuvchi parol bilan tizimga kira olishi kerak", "Sahifa 2 soniyadan tezroq yuklanishi kerak", "Tizim kuniga 24 soat uzluksiz ishlashi kerak"], 1],
    ["Agile manifestiga ko‘ra qaysi qadriyat ustun qo‘yiladi?", ["Ishlayotgan dasturiy ta’minot batafsil hujjatlardan", "Rejaga amal qilish o‘zgarishlarga moslashishdan", "Shartnoma shartlari mijoz bilan hamkorlikdan", "Batafsil hujjatlar ishlayotgan dasturiy ta’minotdan"], 0],
    ["Scrum metodologiyasida sprint davomiyligi qancha bo‘ladi?", ["Kamida uch oy", "Olti oydan bir yilgacha", "Bir oygacha (odatda 1–4 hafta)", "Aniq bir kun"], 2],
    ["Scrum’da mahsulot bekloggini (Product Backlog) kim boshqaradi?", ["Scrum Master", "Ishlab chiquvchilar (Developers)", "Loyiha homiysi (Sponsor)", "Mahsulot egasi (Product Owner)"], 3],
    ["Scrum Master’ning asosiy roli nima?", ["Loyiha byudjetini tasdiqlab, uning moliyalashtirilishini ta’minlash", "Mahsulot talablarini belgilab, backlogni ustuvorlik bo‘yicha tartiblash", "Scrum jarayonining samaradorligini ta’minlab, to‘siqlarni bartaraf etish", "Dastur kodini yozib, sprint natijasini mustaqil tayyorlash"], 2],
    ["Kundalik Scrum (Daily Scrum) yig‘ilishining davomiyligi qancha?", ["5 daqiqa", "15 daqiqa", "30 daqiqa", "1 soat"], 1],
    ["Kanban metodida WIP limit nimani anglatadi?", ["Backlogdagi vazifalar umumiy sonini cheklash", "Sprintning maksimal davomiyligini cheklash", "Bir vaqtda bajarilayotgan ishlar sonini cheklash", "Jamoa a’zolarining umumiy sonini cheklash"], 2],
    ["Git’da o‘zgarishlarni lokal omborga (repository) saqlash uchun qaysi buyruq ishlatiladi?", ["git fetch", "git clone", "git commit", "git push"], 2],
    ["Git’dagi “git push” buyrug‘i nima vazifani bajaradi?", ["O‘zgarishlarni indeksga (staging) qo‘shadi", "Lokal o‘zgarishlarni masofaviy omborga yuboradi", "Masofaviy ombordan o‘zgarishlarni yuklab oladi", "Omborda yangi tarmoq (branch) yaratadi"], 1],
    ["Git’da ikki tarmoqni (branch) birlashtirish uchun qaysi buyruq ishlatiladi?", ["git status", "git merge", "git init", "git branch"], 1],
    ["Birlik testi (unit test) nimani tekshiradi?", ["Dasturning alohida moduli yoki funksiyasini", "Tizim modullarining o‘zaro birgalikda ishlashini", "Butun tizimning mijoz talablariga muvofiqligini", "Tizimning yuqori yuklama ostida ishlashini"], 0],
    ["“Qora quti” (black box) testlash usulining mohiyati nimada?", ["Ichki kodni bilmay, kirish va chiqish ma’lumotlari asosida tekshirish", "Kod yozish jarayonida dasturchining o‘zi tomonidan tekshirish", "Ichki kod tuzilishi va mantiqini tahlil qilgan holda tekshirish", "Dastur kodini ishga tushirmasdan qo‘lda ko‘zdan kechirib chiqish"], 0],
    ["Debugging (sozlash) deganda nima tushuniladi?", ["Dasturdagi xatolarni topish va tuzatish jarayoni", "Dastur kodini boshqa tilga o‘girish jarayoni", "Dasturni foydalanuvchilarga tarqatish jarayoni", "Dastur interfeysini loyihalash jarayoni"], 0],
    ["Lean Startup konsepsiyasida MVP nima?", ["Investorlar uchun tayyorlangan taqdimot hujjati", "G‘oyani sinashga yetarli minimal funksiyali mahsulot", "Bozorga to‘liq tayyor bo‘lgan yakuniy mahsulot", "Eng ko‘p sotilgan mahsulotning namunaviy nusxasi"], 1],
    ["Lean Startup konsepsiyasining asosiy sikli qaysi?", ["Rejalashtirish – bajarish – tekshirish", "Tahlil – loyihalash – joriy etish", "Yaratish – o‘lchash – o‘rganish", "G‘oya – investitsiya – sotish"], 2],
    ["REST API’da yangi resurs yaratish uchun odatda qaysi HTTP usuli ishlatiladi?", ["POST", "DELETE", "GET", "HEAD"], 0],
    ["UX (foydalanuvchi tajribasi) dizayni nimaga qaratilgan?", ["Ma’lumotlar bazasi jadvallarining normallashtirilishiga", "Server qismining ishlash tezligi va yuklamasiga", "Foydalanuvchining mahsulot bilan ishlash qulayligi va tajribasiga", "Dastur kodining kompilyatsiya qilinish tezligiga"], 2],
    ["Ma’lumotlar bazasini normallashtirishdan asosiy maqsad nima?", ["Ma’lumotlar takrorlanishini kamaytirib, yaxlitlikni ta’minlash", "So‘rovlarni bajarish uchun jadvallar sonini kamaytirish", "Ma’lumotlarni bulutli serverga ko‘chirib joylashtirish", "Ma’lumotlarni shifrlab, ularning xavfsizligini oshirish"], 0],
    ["Dasturiy loyihada README fayli qanday vazifani bajaradi?", ["Dasturning kompilyatsiya qilingan bajariladigan kodini saqlash", "Ma’lumotlar bazasining zaxira nusxasini saqlash", "Loyiha haqida umumiy ma’lumot, o‘rnatish va foydalanish yo‘riqnomasi", "Loyiha byudjeti va xarajatlari bo‘yicha hisobotni saqlash"], 2],
    ["SWOT tahlilidagi “O” harfi nimani anglatadi?", ["Operations (operatsiyalar)", "Objectives (maqsadlar)", "Opportunities (imkoniyatlar)", "Obstacles (to‘siqlar)"], 2]]);
  mk("BBL — Axborot tizimlari va loyihalash", "Texnologiya", "BBL DOCX faylidan kiritilgan 237 ta test. To‘g‘ri javoblar belgilangan.", bblQuestions);
  mk("BBL — Axborot tizimlari va loyihalash", "Texnologiya", "BBL DOCX faylidan kiritilgan 237 ta test. To‘g‘ri javoblar belgilangan.", bblQuestions);
  save();
}
