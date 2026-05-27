# Site Checker — PPC моніторинг

Платформа для автоматичної перевірки 40+ сайтів на наявність аналітики, форм, месенджерів та інших конверсійних елементів.

## Що перевіряє
- ✅ Доступність сайту (HTTP статус, час завантаження)
- ✅ SSL сертифікат (термін дії)
- ✅ Google Analytics 4
- ✅ Google Tag Manager
- ✅ Google Ads конверсійний тег
- ✅ Форми на сторінці
- ✅ Binotel / Ringostat / колтрекінг
- ✅ Клікабельний телефон (tel:)
- ✅ WhatsApp, Telegram, Viber, Instagram
- ✅ Noindex (сторінка прихована від Google)
- ✅ AI підсумок: що критично, що ок, що зробити

---

## 🚀 Деплой на Vercel (5 кроків, без коду)

### Крок 1 — GitHub
1. Зайди на [github.com](https://github.com) і зареєструйся (або увійди)
2. Натисни **New repository** → назви `site-checker` → **Create repository**
3. Завантаж всі файли з цієї папки в репозиторій (кнопка **uploading an existing file**)

### Крок 2 — Vercel
1. Зайди на [vercel.com](https://vercel.com) → **Sign up with GitHub**
2. Натисни **Add New → Project**
3. Вибери репозиторій `site-checker` → **Import**

### Крок 3 — Змінні середовища (ВАЖЛИВО)
В розділі **Environment Variables** додай:
```
Name:  ANTHROPIC_API_KEY
Value: sk-ant-... (твій API ключ від Anthropic)
```
Де взяти ключ: [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key

### Крок 4 — Deploy
Натисни **Deploy** — Vercel сам встановить залежності і запустить сайт.
Через 1-2 хвилини отримаєш посилання типу `site-checker-xxx.vercel.app`

### Крок 5 — Готово!
Відкрий посилання, завантаж список сайтів і запускай перевірку.

---

## Формат CSV для завантаження
```
https://site1.com,Ремонт квартир
https://site2.com,Вікна Київ
https://site3.com,Стоматолог Львів
```
Або просто список URL без назв — кожен на новому рядку.

## Експорт в Google Sheets
1. Після перевірки натисни **↓ Експорт CSV для Sheets**
2. Відкрий Google Sheets → Файл → Імпортувати → вибери файл
3. Роздільник: кома, кодування: UTF-8

---

## Технічний стек
- Next.js 14 (React)
- Серверні API routes (обходить CORS)
- Anthropic Claude API (AI підсумок)
- Vercel (хостинг, безкоштовний план)

## Вартість
- Vercel: безкоштовно (Hobby план, 100GB трафік/міс)
- Anthropic API: ~$0.01-0.05 за одну перевірку всіх сайтів (дуже дешево)
