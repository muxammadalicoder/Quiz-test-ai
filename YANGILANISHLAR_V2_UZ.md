# Quiz Arena v2 — yangilanishlar

## Tuzatilgan xatolar
- **"Mening testlarim" ilovani qulatardi**: `Screens.tsx` da `Plus` import qilinmagan edi — tuzatildi.
- **Yodlash uchun / 50 talik testlar / Aralashtirish**: server `rangeStart`, `rangeEnd`, `shuffleQuestions` ni o'qimas edi. Endi `pick()` hammasini hisobga oladi (yakka o'yin va ommaviy xona).
- **Matn buzilishi**: `<` `>` belgilari o'chirilmaydi (`IaaS -> PaaS`), savol 400, variant 200 belgigacha.
- **AI tekshiruvi limiti**: `/api/ai/verify-quiz` kuniga `AI_VERIFY_DAILY` (8) marta.
- **Oq ekran**: `ErrorBoundary` qo'shildi; client xatolari serverga yoziladi.
- `Chat.tsx` ishlatilmas va `/api/ai/chat` yo'q edi — ulandi (Profil → "AI bilan suhbat").

## Tegilmagan (so'rovingiz bo'yicha)
- "Tez topish" bo'limi; testni parol (`ADMIN_PASSWORD`) bilan o'chirish.

## Groq
- Matn, tushuntirish, suhbat: `openai/gpt-oss-120b` (zaxira: `llama-3.3-70b-versatile`). Javob o'zbekcha ekani tekshiriladi, aks holda qayta uriniladi.
- Ovozni matnga o'girish: Groq Whisper (`whisper-large-v3`, til `uz`).
- Javoblarni tekshirish: Groq'ning 2 ta modeli (Gemini/GPT bo'lsa ular ham qatnashadi). Faqat `GROQ_API_KEY` yetarli.
- DOCX/PDF import: Groq bilan (PDF uchun `pdf-parse`, skaner PDF o'qilmaydi; Gemini bo'lsa PDF'ni u ham o'qiy oladi).
- **Muhim:** Groq o'zbekcha ovoz CHIQARMAYDI (TTS faqat ingliz/arab). Ovoz uchun: `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` qo'shsangiz `uz-UZ-MadinaNeural` ovozi ishlaydi; bo'lmasa qurilma ovozi.

## AI muhandis (Profil → "AI muhandis")
- Faqat `ADMIN_PASSWORD` bilan. Kodni o'qiydi, xatolarni o'zbekcha tushuntiradi.
- Doimiy kuzatuv: server/client xatolari jurnali + har `DEVAI_AUTO_HOURS` (6) soatda avtomatik tekshiruv (import qilinmagan komponent, topilmagan fayl/nom, serverda yo'q API yo'llari).
- `/tuzat` yoki "🛠 Tuzat" tugmasi → AI patch tayyorlaydi, siz ko'rib "Qo'llash" bosasiz → GitHub'ga commit → Render qayta joylaydi.
- Kerak: `GROQ_API_KEY`, `ADMIN_PASSWORD`, tuzatishlar uchun `GITHUB_TOKEN` (Contents: read/write) va `GITHUB_REPO` (`egasi/repo`). Repo ildizi boshqa papkada bo'lsa `GITHUB_PATH_PREFIX`.
- Himoya: AI `devai.ts`, `auth.ts` va savollar bazasini, shuningdek "Tez topish" va parol bilan o'chirish kodini o'zgartira olmaydi.
