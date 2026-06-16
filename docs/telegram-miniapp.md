# Telegram Mini App — мастер-план (Bambusito228 Admin)

URL: `https://bambusito.up.railway.app/admin/tg`  
Вход: Menu-кнопка в боте → без пароля (Telegram `initData` + `TELEGRAM_ADMIN_IDS`).

---

## Этап 1 — Инфраструктура и авторизация

- [x] `server/telegramWebApp.js` — проверка подписи `initData` (HMAC WebAppData)
- [x] `POST /api/admin/tg-auth` — выдача JWT админу по Telegram ID
- [x] `GET /admin/tg` — страница Mini App
- [x] `setChatMenuButton` в боте → web_app URL
- [x] `PUBLIC_URL` в env (fallback: `https://bambusito.up.railway.app`)

**Проверка:** открыть бота → Menu → «Админка» → загрузка без логина/пароля.

---

## Этап 2 — Мобильная оболочка UI

- [x] Нижняя навигация: Обзор | Ордера | Чат | Настройки
- [x] Интеграция `Telegram.WebApp`: `expand`, theme colors, safe-area
- [x] Экран «только из Telegram» при открытии вне бота
- [x] Loader при авторизации

**Проверка:** тема подстраивается под Telegram (светлая/тёмная).

---

## Этап 3 — Обзор и ордера

- [x] Карточки статистики (всего / ожидают / выполнено / наценка / источник курса)
- [x] Последние ордера на обзоре
- [x] Полный список ордеров + смена статуса (крупный select)
- [x] Pull-to-refresh через кнопку обновления

**API:** `GET /api/admin/dashboard`, `GET/PATCH /api/admin/orders/:id`

---

## Этап 4 — Чат с посетителями

- [x] Список диалогов с бейджем непрочитанных
- [x] Полноэкранный оверлей переписки
- [x] `BackButton` Telegram для возврата к списку
- [x] Отправка ответа, автообновление каждые 8 с

**API:** `GET/POST /api/admin/chat/sessions/*`

---

## Этап 5 — Настройки

- [x] Наценка, USD/RUB, TTL ордера, кошелёк, имя оператора чата
- [x] Источник курса + проверка провайдеров
- [x] `MainButton` Telegram — «Сохранить»

**API:** `PATCH /api/admin/settings`, `GET /api/admin/rate-status`

---

## Этап 6 — Полировка (будущее)

- [ ] Push при новом ордере с deep-link в Mini App
- [ ] Haptic на смену статуса ордера
- [ ] Офлайн-индикатор
- [ ] Смена пароля (только в веб-админке `/admin`)

---

## Переменные Railway

| Переменная | Назначение |
|------------|------------|
| `TELEGRAM_BOT_TOKEN` | Бот + проверка initData |
| `TELEGRAM_ADMIN_IDS` | Кто может войти в Mini App |
| `JWT_SECRET` | Токен после tg-auth |
| `PUBLIC_URL` | `https://bambusito.up.railway.app` |

Не задавать `TELEGRAM_PROXY` на Railway.

---

## BotFather (опционально)

Menu Button выставляется кодом при старте бота.  
В BotFather можно проверить: Bot Settings → Menu Button → должна совпадать с `/admin/tg`.
