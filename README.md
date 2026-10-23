# Quiz Arena — Telegram mini ilova (O‘zbekcha), 100% bepul joylash

**Imkoniyatlar:** Telegram orqali xavfsiz kirish · test yaratish · yakka va ommaviy (xona) o‘yin · tasodifiy 20/25/30 savol · testni yakunlash (guruhda faqat boshlovchi) · onlayn soni · javoblar tahlili · 🥇🥈🥉 podium · animatsiyali avatarlar, XP va reyting · **🎙 AI bilan ovozli suhbat** (AI savolni o‘qiydi, javobni tekshiradi, xatoni tushuntiradi).

## Bepul joylash (4 ta xizmat, hammasi kartasiz)
1. **GitHub** — shu papkani yangi repoga yuklang.
2. **Neon** (neon.com) — bepul Postgres. Ro‘yxatdan o‘ting → *Create project* → **Connection string** (`postgresql://...`) ni nusxalang. Bu foydalanuvchilar va testlar o‘chib ketmasligi uchun kerak.
3. **Google AI Studio** (aistudio.google.com) → *Get API key* → kalitni nusxalang. Bu bepul AI uchun.
4. **Telegram @BotFather** → `/newbot` → bot tokeni va username oling.
5. **Render** (render.com) → *New → Web Service* → GitHub repongizni tanlang:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start`
   - Instance type: **Free**
   - Environment’ga qo‘shing: `BOT_TOKEN`, `BOT_USERNAME` (@siz), `DATABASE_URL`, `GEMINI_API_KEY`, `ALLOW_GUEST=false`, `NODE_VERSION=22`
   - Birinchi joylashdan keyin Render bergan manzilni (`https://....onrender.com`) `WEBAPP_URL` ga yozing → *Save* (qayta joylanadi).
6. Telegram’da botga `/start` yozing → **O‘ynash**.

## Muhim
- Render bepul rejasida server 15 daqiqa jim tursa uxlaydi, birinchi ochilish sekin. Uxlamasligi uchun bepul **UptimeRobot** bilan `https://MANZIL/health` ni har 5 daqiqada tekshirtiring.
- Neon bepul bazasi kichik loyiha uchun yetadi. `DATABASE_URL` qo‘yilmasa, ma’lumotlar Render’da har qayta joylashda o‘chadi.
- AI limiti: har foydalanuvchiga kuniga 60 ta izoh (`AI_DAILY_LIMIT`), butun ilova uchun 900 (`AI_GLOBAL_DAILY`). Bepul limitlar o‘zgarishi mumkin.
- **Ovozli rejim brauzer/Telegram imkoniyatiga bog‘liq:** ovoz chiqarish ko‘p telefonda ishlaydi, lekin o‘zbek ovozi har doim ham bo‘lmaydi (bunda turk/rus ovozi ishlatiladi). Ovoz bilan javob berish (mikrofon) ba’zi qurilmalarda (ayniqsa iPhone Telegram’ida) ishlamasligi mumkin — shunda tugma bilan javob beriladi.
- Ovozli rejimda savolni o‘qishga 20 soniya qo‘shimcha vaqt beriladi.

## O‘z testlaringizni qo‘shish
`server/src/store.ts` ichidagi `seedQuizzes()` da `mk("Nomi", "Mavzu", "Tavsif", [["Savol?", ["A","B","C","D"], togriIndeks], ...])` ko‘rinishida qo‘shing. Yangi nomli testlar bazani o‘chirmasdan o‘zi qo‘shiladi.

## Mahalliy ishga tushirish
```bash
npm install
npm run dev   # http://localhost:5173 (BOT_TOKEN bo‘lmasa mehmon sifatida kirish yoqiladi)
```
Tekshirish: `npm run typecheck -w server` va `npm run typecheck -w client`.


## PDF orqali test import qilish

`Testlar` bo'limidagi **PDF orqali test yuklash (Gemini AI)** tugmasi yordamida telefon yoki kompyuterdan PDF yuklash mumkin. Server Gemini orqali savollar va javob variantlarini ajratadi, natijani tekshirish uchun ko'rsatadi va foydalanuvchi tasdiqlagandan keyin test sifatida saqlaydi. Bir PDF 15 MB gacha, bitta test esa 200 tagacha savolni qo'llab-quvvatlaydi.

- Render/server muhitida `GEMINI_API_KEY` sozlangan bo'lishi kerak.
- `AI_PDF_DAILY` bir foydalanuvchi uchun kunlik PDF tahlil limitini belgilaydi (standart: 5).
- Gemini noto'g'ri javobni belgilashi mumkin; saqlashdan oldin ko'rsatilgan javoblarni tekshiring.
- PDF import qilish endpointi: `POST /api/quizzes/import-pdf` (multipart form-data, `pdf` maydoni).

## PDF orqali Gemini AI bilan test import qilish

`Testlar` bo'limidagi **PDF orqali test qo'shish** funksiyasi PDF faylni serverga yuboradi. Serverdagi `GEMINI_API_KEY` orqali Gemini PDFning barcha sahifalarini, savollarni, variantlarni va mavjud bo'lsa hujjat oxiridagi javoblar kalitini tahlil qiladi. Javoblar kalitidagi belgilar savollarga moslanadi; kalit yo'q bo'lsa, Gemini savolni bilim asosida yechishga harakat qiladi. Har bir savolning `correct` maydoni to'g'ri variant indeksini belgilaydi.

Gemini natijasi avval ko'rib chiqish oynasida chiqadi. Javoblar indeksini tekshirish/o'zgartirish mumkin; **Testlarga saqlash** bosilgandan keyingina test ilovaga qo'shiladi. Bu mavjud testlar va o'yinlarni tasodifan o'zgartirmaslik uchun ataylab saqlangan tasdiqlash bosqichidir. Yuklash limiti 15 MB, bitta PDFdan 200 tagacha savol.

Render muhitida `GEMINI_API_KEY` o'rnatilgan bo'lishi shart. AI javoblari mutlaq kafolatli emas; ayniqsa PDFda javoblar kaliti bo'lmasa, saqlashdan oldin natijani tekshiring.
