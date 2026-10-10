# Languages — English + 简体中文 (one platform, a language per person)

Same system, same data, same workflow — a different language for each person. A Chinese customer orders in Chinese;
the kitchen reads the same order in English; the boss reads reports in Chinese while reception works in English.
Nothing is duplicated: one database, one order, one payment. Language never affects permissions or business logic.

## Who gets which language
| Where | Language comes from |
|---|---|
| Staff app (`/staff`, reports pages for staff) | the signed-in person's own `User.preferredLanguage` (EN/中文 switch in the top bar, saved on their account) |
| Website (`/`, `/rooms`, `/book`, …) | the visitor's choice (cookie `vlh-lang`), else a Chinese phone → Chinese, else English. Served from `app/(public)/[lang]` — `src/proxy.ts` maps `/rooms` → `/en/rooms` or `/zh/rooms` (cached per language); addresses never change |
| Guest pages (`/t` `/r` `/b` `/order` `/stay` `/pay` `/thanks`) | the same visitor choice (`guestLocale()`); a guest's WhatsApp links carry `?lang=zh` |
| WhatsApp / messages to a guest | `Guest.preferredLanguage` (saved when they chose a language and booked/ordered, or set by staff) |
| Reports sent to the boss | the recipient's language (Settings → report recipients) |

## Writing translatable code — English IS the key
```ts
// client component ("use client")
import { useT } from "@/i18n/client";
const t = useT();
t("Check in");                                  // → "办理入住" for a Chinese user, "Check in" otherwise
t("Room {room} is ready", { room: r.number });  // placeholders kept identical in every language
t.plural(n, "{n} night", "{n} nights");          // never `${n} night${n === 1 ? "" : "s"}`
t.rich("Only <b>Paid</b> is money in", { b: (c) => <strong>{c}</strong> }); // sentences with markup inside
t.ctx("menu", "Available");                     // a word with another meaning here: catalog key "menu::Available"
t.date(businessDate) / t.date(d, true) / t.shortDate(d) / t.dateRange(a, b) / t.dayMonth(d)
t.dateTime(instant, tz) / t.time(instant, tz)  // hotel time zone kept; only the wording changes
new Intl.DateTimeFormat(t.intl, {...})           // instead of "en-GB"

// async server component / page / layout / generateMetadata / server action
import { getT } from "@/i18n/server";
const t = await getT();

// a value DEFINED in one place and SHOWN in another (lookup maps, zod messages, AppError text, success messages)
import { msg, msgf } from "@/i18n/msg";
const STATUS = { READY: { label: msg("Ready") } };          // shown with t(STATUS[s].label)
z.string().min(2, msg("Enter the guest's name."))           // translated automatically when the action answers
throw new AppError("Room not found.", "NOT_FOUND");           // static text: translated automatically (add it to the catalog)
throw new AppError(msgf("Room {room} is not ready.", { room })); // text with values: msgf, never a template literal
return runAction(fn, msg("Trip updated."));                   // success message
```
- **Translate only where it is shown.** Never change a value used for logic, keys, comparisons, URLs, DB writes or
  tests — e.g. `g.title === "Finance"` stays; render `t(g.title)`.
- The English text must stay **exactly** as it was (it is the key and tests read it).
- `formatTZS`, numbers, IDs, references, room numbers, phone numbers, amounts: unchanged.
- Formatters in `src/lib/format.ts` are English; use the `t.*` date helpers on screens.

### The hotel's own content
Dish/category names and descriptions, room type names/descriptions/bed type, amenities, hotel services, transport
services/options: wrap at display — `t(item.name)`, `t(room.description)`. They resolve to the translation staff
saved (MenuItemTranslation…, Settings → Languages), else the built-in default (`src/i18n/content/zh-CN.ts`), else English.
Hotel-configured labels (payment account/method names, booking sources, locations/areas, expense/revenue categories,
inventory departments, role names) may also be wrapped `t(name)` — they fall back to themselves.

Order lines: `orderItemName(item, t)` from `@/i18n/content` (needs `nameI18n` selected) — the name as ordered.

### Never translate
People's and companies' names, addresses, references/IDs/tokens, phone/email, amounts, payment references, what a
customer or staff member typed (notes, reasons, requests — show the original; customer requests ticked from
`ORDER_REQUESTS` in `src/lib/order-requests.ts` are codes → `t(requestLabel(code))`), audit-log contents.

### Same English, different meaning
Server-side, guest pages (website/QR/stay) prefer the `public` catalogs and staff pages prefer `staff` ones, so a word
can differ between guests and staff ("Served", "Book", "From"). Inside ONE area, when a short word means two things
("Available" for a room vs a dish, "Transfer" for a car vs handing an order over), use `t.ctx("<context>", "Word")`
and add the catalog key `"<context>::Word"`.

## Where translations live
`src/i18n/catalog/zh-CN/<bundle>/<area>.ts` — `{ "English": "中文" }` (default export, type `Catalog`).
Bundles: `common` (shared everywhere), `public` (sent to customers' browsers), `staff` (staff browsers),
`server` (only used on the server: AppError/validation/report/WhatsApp text). A client component's strings must be in
a bundle its browser receives (public/staff/common). `npm run i18n:index` rebuilds the bundle indexes;
`npm run i18n:check` reports missing strings and placeholder mismatches (and writes `coverage.ts`);
`node scripts/i18n.mjs missing <files/folders…>` lists what is untranslated in your area.

## Chinese style (hotel, Simplified Chinese, mainland conventions)
Natural, concise, polite (您 to guests; plain imperative on staff buttons). Keep `{placeholders}` and `<tags>`
exactly. Full-width punctuation in Chinese text （，。：？！）; keep "TZS", numbers, references and brand names as they
are ("Vegas Luxury Hotel", "WhatsApp", "nTZS", "M-Pesa", "Wi-Fi", "QR").

Glossary (use consistently): booking/reservation 预订 · book now 立即预订 · check-in 入住 / 办理入住 · check-out 退房 /
办理退房 · in house 在住 · arrival 抵达 · departure 离店 · night 晚 · guest 客人 · customer 顾客 · reception 前台 ·
receptionist 前台接待 · manager 经理 · managing director (MD) 总经理 · owner/boss 老板 · waiter 服务员 · kitchen 厨房 ·
chef/Mpishi 厨师 · restaurant 餐厅 · bar 酒吧 · room service 客房送餐 · order 订单 · table 餐桌 · menu 菜单 · dish 菜品 ·
drink 饮品 · counter 收银台 · bill 账单 · invoice 发票 · receipt 收据 · payment 付款 · paid 已付款 · unpaid 未付款 ·
balance 余额 / 待付金额 · deposit 定金 · refund 退款 · discount 折扣 · mobile money 手机支付 · cash 现金 ·
pay online 在线支付 · collections 收款 · income 收入 · expenses 支出 · ledger 账簿 · account 账户 · shift 班次 ·
start shift 开始上班 · end shift 结束班次 · report 报告 · daily report 日报 · room 房间 · room type 房型 · available 空闲 ·
occupied 已入住 · reserved 已预订 · dirty 待清洁 · cleaning 清洁中 · ready (room) 可入住 · maintenance 维修中 ·
out of service 停用 · housekeeping 客房部 · meeting room 会议室 · transport 交通 / 接送 · airport pickup 接机 ·
airport drop-off 送机 · driver 司机 · trip 行程 · group 团体 · company 公司 · corporate 企业客户 · stock 库存 ·
inventory 库存管理 · asset 资产 · supplier 供应商 · settings 设置 · staff 员工 · role 角色 · permission 权限 ·
pending 处理中 / 待处理 · confirmed 已确认 · cancelled 已取消 · completed 已完成 · preparing 准备中 · served 已上菜 ·
delivered 已送达 · no-show 未到店 · walk-in 散客.
