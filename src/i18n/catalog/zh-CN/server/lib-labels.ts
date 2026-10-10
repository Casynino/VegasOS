import type { Catalog } from "../../../translate";

// Messages made on the server by src/server (auth, desk, rate limit, validation, waiter on the Counter) and by
// src/lib/time/stay.ts and src/lib/discounts.ts — translated when a server action answers.
const catalog: Catalog = {
  // Signing in, permissions, shifts (server/auth.ts)
  "Password must be at least 10 characters.": "密码至少需要 10 个字符。",
  "Password must contain letters and numbers.": "密码必须同时包含字母和数字。",
  "Your session has expired. Please sign in again.": "您的登录已过期，请重新登录。",
  "You do not have permission to do this.": "您没有执行此操作的权限。",
  "You have no active shift — start your shift (or ask a manager) before doing reception work.": "您当前没有进行中的班次 — 请先开始您的班次（或请经理处理），再进行前台工作。",
  // Reception works for hotel guests (server/desk.ts)
  "That is a restaurant customer's order — the restaurant handles it. Reception works on hotel guests' orders.": "这是餐厅顾客的订单 — 由餐厅处理。前台只处理酒店客人的订单。",
  "Reception works for guests staying in the hotel — anyone else goes to the restaurant directly.": "前台只为在住客人服务 — 其他顾客请直接到餐厅。",
  "That table is the restaurant's — reception handles tables where a hotel guest sits.": "这张餐桌由餐厅负责 — 前台只处理有酒店客人就座的餐桌。",
  // Rate limit and forms (server/rate-limit.ts, server/validation.ts)
  "Too many attempts. Please wait a few minutes and try again.": "尝试次数过多，请等几分钟后再试。",
  "Something in the form is not right — please check it and try again.": "表单中有内容不正确 — 请检查后重试。",
  "Please check the form.": "请检查表单。",
  // The waiter on the Restaurant Counter (server/waiter-pin.ts) — {what} is one of the work names below
  "On the Restaurant Counter, {what} needs the waiter who serves it — choose them from the list.": "在餐厅收银台上，{what}需要指定负责的服务员 — 请从名单中选择。",
  "Choose the waiter from the list.": "请从名单中选择服务员。",
  "Required": "必填",
  "Invalid": "无效",
  "making an order": "下单",
  "serving an order": "上菜",
  "adding to an order": "加菜",
  "serving a table": "服务餐桌",
  "transferring an order": "转交订单",
  "transferring a table": "转交餐桌",
  "transferring room service": "转交客房送餐",
  "handing over work": "交接工作",
  "seating a customer": "安排顾客入座",
  // Stays that cannot be (lib/time/stay.ts) — shown as `new AppError(e.message)`, so the filled-in English is here too
  "Invalid arrival or departure date.": "抵达或离店日期无效。",
  "Check-out must be after check-in.": "退房日期必须晚于入住日期。",
  "Stays are limited to {max} nights.": "住宿最多 {max} 晚。",
  "Stays are limited to 90 nights.": "住宿最多 90 晚。",
  "Arrival time does not fall on the arrival business date.": "抵达时间不在抵达营业日内。",
  "Check-out time must be after check-in time.": "退房时间必须晚于入住时间。",
  "Short time must end after it starts.": "钟点房的结束时间必须晚于开始时间。",
  "Short time is at most {hours} hours.": "钟点房最长 {hours} 小时。",
  "Short time is at most 7 hours.": "钟点房最长 7 小时。",
  "Choose the meeting date, start and end time.": "请选择会议日期、开始时间和结束时间。",
  "The meeting must end after it starts.": "会议的结束时间必须晚于开始时间。",
  "A meeting booking is at least {minutes} minutes.": "会议室预订至少 {minutes} 分钟。",
  "A meeting booking is at least 30 minutes.": "会议室预订至少 30 分钟。",
  "A meeting booking is at most {hours} hours — book each day separately.": "会议室预订最长 {hours} 小时 — 请按天分别预订。",
  "A meeting booking is at most 16 hours — book each day separately.": "会议室预订最长 16 小时 — 请按天分别预订。",
  "A walk-in stay needs at least one night.": "散客入住至少需要一晚。",
  // Manual discounts (lib/discounts.ts)
  "The most off a room is TZS {amount} per night.": "每间房每晚最多优惠 TZS {amount}。",
};
export default catalog;
