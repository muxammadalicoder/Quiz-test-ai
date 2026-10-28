# Quiz Arena — yangilangan paket (o‘zbekcha)

## Paketda mavjud asosiy imkoniyatlar
- Telegram Mini App uchun React/Vite frontend va Node.js/Socket.IO server.
- Yakka test va real vaqt xonalari; xona kodi bilan do‘stlarni taklif qilish.
- Testlarni qo‘lda yaratish va tahrirlash; bitta testga 300 tagacha savol.
- PDF/DOCX dan Gemini AI yordamida 300 tagacha savol ajratish (API kaliti talab qilinadi).
- Gemini yordamida test savolini ovoz chiqarib o‘qish va ovozdan variant tanlash.
- Profil, XP/daraja, umumiy reyting, o‘yin statistikasi va ochiladigan yutuqlar.
- Gemini 429/5xx kabi vaqtinchalik xatolarida qayta urinish va model fallback.

## Muhim eslatma
AI funksiyalari uchun Render Environment’da `GEMINI_API_KEY` to‘g‘ri kiritilgan bo‘lishi kerak. Google API’da model mavjudligi, limit va TTS qo‘llab-quvvatlashi hisob/regionga qarab farq qilishi mumkin. Ovoz va mikrofonni haqiqiy iPhone Telegram Mini App ichida sinash shart.

Rejalashtiriladigan alohida katta funksiyalar: jadval asosida rasmiy turnirlar, kunlik topshiriqlarni serverda saqlash, guruh/o‘qituvchi hisobotlari va batafsil mavzu kesimidagi o‘quv tahlili. Ular mavjud kodda to‘liq backend funksiyasi sifatida yoqilgan deb hisoblanmasin.

## Lokal ishga tushirish
Node.js 20 yoki yangiroq versiya kerak.

```bash
npm install
npm run dev
```

Frontend odatda `http://localhost:5173`, backend esa `http://localhost:3001` da ishga tushadi.

## Build
```bash
npm run build
```

## Render
- Root directory: repository root.
- Build command: `npm install && npm run build`.
- Start command: `npm start`.
- `DATABASE_URL`, `SESSION_SECRET`, bot sozlamalari va `GEMINI_API_KEY` ni Render Environment’da saqlang; maxfiy kalitlarni ZIP/GitHub kodiga yozmang.

Yangi versiyani joylashdan oldin GitHub’dagi eski kodni zaxiralang. Deploy’dan keyin test yaratish, PDF/DOCX import, yakka o‘yin, xona kodi, TTS va mikrofonni tekshiring.
