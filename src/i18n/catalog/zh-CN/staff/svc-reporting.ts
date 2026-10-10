// A waiter's history (server/services/waiter-activity.ts): each line's key and values travel with it (`say`) and are
// written in the reader's language in the browser (the waiter's record, the Waiters page) — so they live in the staff
// bundle. Words already in the common/staff catalogs (Room {room}, Counter, a manager…) are not repeated.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Where and what
  "{no} · {place}": "{no} · {place}",
  "an order": "一个订单",
  "a table": "某餐桌",
  "a colleague": "一位同事",
  "{text} — {reason}": "{text} — {reason}",
  // The shift
  "Shift closed by a manager": "经理关闭了班次",
  // Orders taken, given and handed over
  "{what} assigned to you at the Counter": "{what} 已在收银台分配给您",
  "Claimed {what}": "认领了 {what}",
  "{what} given to you by {manager} (from {from})": "{manager} 将 {what} 交给您（原属 {from}）",
  "{what} handed to you by {from}": "{from} 将 {what} 转交给您",
  "{what} given to you by {manager}": "{manager} 将 {what} 交给您",
  "{what} came to you (your table)": "{what} 归您负责（您的餐桌）",
  "{what} came to you (your room)": "{what} 归您负责（您的房间）",
  "{what} assigned to you": "{what} 已分配给您",
  "{what} released": "{what} 已释放",
  "{what} taken off you by {manager}": "{manager} 将 {what} 从您名下移走",
  "Handed {what} to {to}": "将 {what} 转交给 {to}",
  "{what} moved to {to} by {manager}": "{manager} 将 {what} 转给 {to}",
  "{what} moved to {to}": "{what} 已转给 {to}",
  // Steps on an order
  "Created {order}": "创建了 {order}",
  "Accepted {order}": "接单 {order}",
  "Started preparing {order}": "开始准备 {order}",
  "Marked ready {order}": "标记就绪 {order}",
  "Serving {order}": "正在上菜 {order}",
  "Served {order}": "已上菜 {order}",
  "Completed {order}": "已完成 {order}",
  "Cancelled {order}": "已取消 {order}",
  "{step} {order}": "{step} {order}",
  // Bills printed, downloaded or shared
  "{note} · {order}": "{note} · {order}",
  "Bill printed": "已打印账单",
  "Bill downloaded (PDF)": "已下载账单（PDF）",
  "Bill downloaded (image)": "已下载账单（图片）",
  "Bill shared": "已分享账单",
  "Table bill printed": "已打印餐桌账单",
  "Table bill downloaded (PDF)": "已下载餐桌账单（PDF）",
  "Table bill downloaded (image)": "已下载餐桌账单（图片）",
  "Table bill shared": "已分享餐桌账单",
  "Room bill printed": "已打印房间账单",
  "Room bill downloaded (PDF)": "已下载房间账单（PDF）",
  "Room bill downloaded (image)": "已下载房间账单（图片）",
  "Room bill shared": "已分享房间账单",
};
export default catalog;
