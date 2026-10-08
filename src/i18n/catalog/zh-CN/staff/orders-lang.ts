import type { Catalog } from "../../../translate";

// Restaurant orders for staff: board / kitchen cards, the customer's requests and note, Take an order, slips.
const catalog: Catalog = {
  // The customer's requests and own words
  "Requests": "要求",
  "Customer's note": "顾客备注",
  "Written in Chinese": "中文书写",
  "Translate": "翻译",

  // Order cards
  "{dish} — done": "{dish} — 已完成",
  "{dish} — not done": "{dish} — 未完成",
  "Served before: {items}": "之前已上：{items}",
  "Remove {dish}": "删除 {dish}",
  "Remove from the order": "从订单中删除",
  "Sold out": "已售罄",
  "{price} each": "单价 {price}",

  // Order steps and where an order came from
  "Accept": "接单",
  "Serve": "上菜",
  "Ready to serve": "可上菜",
  "Serving": "上菜中",
  "Room QR": "房间二维码",
  "Table QR": "餐桌二维码",
  "Counter QR": "收银台二维码",
  "Restaurant QR": "餐厅二维码",
  "Waiter": "服务员",
  "Public menu QR": "公共菜单二维码",
  "Website menu": "网站菜单",
  "Guest's stay link": "客人入住链接",

  // The order slip
  "Order slip": "订单小票",
  "Walk-in customer": "散客",
  "New · added {time}": "新加 · {time}",
  "Round {n} · {time}": "第 {n} 轮 · {time}",
  "Crossed out = served earlier.": "划线 = 之前已上。",
  "Special instructions": "特别要求",
  "Time: {time} · {date}": "时间：{time} · {date}",
  "Placed by: {name}": "下单人：{name}",
  "Printed: {time}": "打印时间：{time}",
  "Print slip": "打印小票",
};
export default catalog;
