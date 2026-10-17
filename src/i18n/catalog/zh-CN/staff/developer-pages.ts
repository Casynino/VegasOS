// The Developer console's Audit page (/staff/developer/audit) and Business page (/staff/developer/business), and the plain words for the
// new Developer entries in the audit trail (working as someone, suspending, business visits).
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Audit — who did it, and the sentence
  "{developer} (Developer) as {person} ({role})": "{developer}（开发者）以 {person}（{role}）的身份操作",
  "{developer} (Developer) as {person}": "{developer}（开发者）以 {person} 的身份操作",
  "{name} (Developer)": "{name}（开发者）",
  "{name} ({role})": "{name}（{role}）",
  "Developer (as {person})": "开发者（以 {person} 的身份）",
  "{who} {did}.": "{who}{did}。",
  "Succeeded": "成功",
  "Working as": "代为操作的对象",

  // Audit — the page
  "The permanent diary of the system: who did what, and when. Developer actions can't be edited or deleted — not even from the database.": "系统的永久记录：谁在何时做了什么。开发者的操作无法被修改或删除——即使从数据库也不行。",
  "How to read this page": "如何阅读此页",
  "Each line is one thing that happened. A <gold></gold> gold dot and a <b>Developer</b> tag mean it was done by you — including when you worked as someone (shown as “you (Developer) as them”). A <blue></blue> blue dot is normal staff work, a <grey></grey> grey dot is the system, and a <red></red> red dot is something that failed. Use the filters to show only your actions, or only failures.": "每一行是一件已发生的事。<gold></gold> 金色圆点和 <b>开发者</b> 标记表示这是您本人所做——包括您以他人身份操作时（显示为“您（开发者）以对方的身份”）。<blue></blue> 蓝色圆点是普通员工的操作，<grey></grey> 灰色圆点是系统，<red></red> 红色圆点表示失败的操作。可用筛选只查看您的操作，或只查看失败的操作。",
  "Search the audit": "搜索审计记录",
  "Search who, what or where…": "搜索：谁、做了什么、在哪里…",
  "Developer actions": "开发者操作",
  "Failures": "失败记录",

  // Business — the page
  "A look at the business data — stays, money, restaurant, stores and customers — in plain tables.": "查看业务数据——住宿、款项、餐厅、库房和顾客——以简单的表格呈现。",
  "Look, don't touch": "只看，不动",
  "This page is read-only: nothing here can be edited, so you can check a number safely. If a record is wrong, the person who owns it fixes it — or you can use <work>Work as</work> to see their screen. Each visit to this page is recorded in the audit log.": "此页面为只读：这里的任何内容都无法编辑，因此您可以放心核对数字。如果某条记录有误，由负责该记录的人来修改——或者您可以使用<work>以此身份工作</work>查看对方的屏幕。每次访问此页面都会记入审计日志。",
  "Business data": "业务数据",
  "Latest {n} · read-only": "最近 {n} 条 · 只读",

  // Business — the tables
  "There are no bookings yet.": "还没有任何预订。",
  "Code": "编号",
  "No payments have been recorded yet.": "还没有任何付款记录。",
  "State": "状态",
  "Posted": "已入账",
  "No expenses have been recorded yet.": "还没有任何支出记录。",
  "Payee": "收款方",
  "There are no restaurant orders yet.": "还没有任何餐厅订单。",
  "Waiting for confirmation": "等待确认",
  "Stock movements": "库存变动",
  "No stock has moved yet.": "还没有任何库存变动。",
  "Items below their minimum": "低于最低库存的品项",
  "No item is below its minimum.": "没有品项低于最低库存。",
  "On hand": "现有库存",
  "There are no customers yet.": "还没有任何顾客。",
  "Last stay": "最近一次入住",
  "VIP": "VIP",

  // The audit trail's plain words for the new Developer entries
  "looked at the business data": "查看了业务数据",
  "started working as another person": "开始以他人的身份操作",
  "stopped working as another person": "结束了以他人身份的操作",
  "was refused when trying to work as another person": "尝试以他人身份操作时被拒绝",
  "suspended a staff account": "停用了员工账号",
  "signed a person out of every device": "让某人在所有设备上退出了登录",
};

export default catalog;
