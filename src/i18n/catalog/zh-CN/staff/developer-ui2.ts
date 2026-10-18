// Developer console, second round of fixes: plain words for the audit lines (Work as named, expiry, Boss notice, refusals), the chart numbers table,
// the honest wording about the audit trail, and the texts that changed with the new rules (shifts, locked sign-in, capped failed sign-ins).
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Plain words for audit lines (the person is named when the record says who)
  "started working as {person}": "开始以 {person} 的身份操作",
  "stopped working as {person}": "结束了以 {person} 的身份的操作",
  "Working as another person ended by itself (the time was over or the session ended)": "以他人身份的操作已自动结束（时间已到或登录会话已结束）",
  "Working as {person} ended by itself (the time was over or the session ended)": "以 {person} 身份的操作已自动结束（时间已到或登录会话已结束）",
  "Notice to the Boss about working as another person": "就以他人身份操作一事通知老板",
  "Notice to the Boss about working as {person}": "就以 {person} 的身份操作一事通知老板",
  "tried to use the Developer's pages and was refused": "尝试使用开发者页面，被拒绝",
  "More failed sign-ins followed in a short time (not every one is listed)": "短时间内又有更多登录失败（未逐条列出）",
  "could not suspend a staff account": "未能停用员工账号",
  "could not switch a staff account back on": "未能重新启用员工账号",
  "could not sign a person out of every device": "未能让某人在所有设备上退出登录",
  "was refused a change to the settings about money": "更改与资金有关的设置被拒绝",

  // Chart numbers
  "Show the numbers": "显示数字",
  "Hide the numbers": "隐藏数字",
  "The last 14 days, coloured by who signed in. A day runs from {start} to {start} the next morning (hotel time). Hover a bar for exact numbers; the table below has them all.": "最近 14 天，按登录者角色着色。一天从 {start} 到次日早晨 {start}（酒店当地时间）。将鼠标悬停在柱条上可查看确切数字；下方的表格列出了全部数字。",
  "The last 7 days. Hover a bar for exact numbers; the table below has them all.": "最近 7 天。将鼠标悬停在柱条上可查看确切数字；下方的表格列出了全部数字。",
  "Everything the team and you saved in the audit trail, 14 days. Sign-ins, just looking and refused attempts are not counted.": "团队和您在审计记录中保存的全部操作，共 14 天。登录、仅仅查看和被拒绝的尝试不计入。",

  // The audit trail: honest wording
  "The permanent diary of the system: who did what, and when. Developer actions can't be edited or deleted — the database refuses it. The only change the system ever makes to an older line is marking a cancelled check-in as cancelled.": "系统的永久记录：谁在何时做了什么。开发者的操作无法被修改或删除——数据库会拒绝。系统对旧记录唯一会做的改动，是把已取消的入住标记为已取消。",
  "The permanent diary of everything done in the system — by staff and by you. Nothing in it is edited or deleted; the only change is that a cancelled check-in is marked as cancelled.": "系统中一切操作的永久记录——包括员工的和您的。其中的内容不会被修改或删除；唯一的改动是把已取消的入住标记为已取消。",
  "Developer entries cannot be edited or deleted — the database refuses it. The only change the system ever makes to an older line is marking a cancelled check-in as cancelled.": "开发者的记录无法被修改或删除——数据库会拒绝。系统对旧记录唯一会做的改动，是把已取消的入住标记为已取消。",
  "From the audit trail: what you did and looked at, newest first. You cannot change this list.": "来自审计记录：您做过和查看过的内容，最新的在前。您无法更改此列表。",

  // Texts that changed with the new rules
  "It also ends when your session ends. Their shift is never started or closed for them.": "您的登录会话结束时，它也会随之结束。也不会替他们开始或结束班次。",
  "It is not offered for the Boss's account.": "老板的账号不提供此功能。",
  "A shift is never started or closed for them either.": "同样，也不会替他们开始或结束班次。",
  "Every page you open is written to the audit trail, once per page every 10 minutes. Only the sign-in page and the “no access” page are left out.": "您打开的每个页面都会写入审计记录，同一页面每 10 分钟记录一次。只有登录页面和“无权访问”页面不记录。",
  "Work as ends by itself after 4 hours, or when this session ends — whichever comes first. The end is written to the audit trail the next time you open a page, or when the session is removed.": "以他人身份工作会在 4 小时后自动结束，或在此登录会话结束时结束——以先到者为准。结束的记录会在您下次打开页面时，或在登录会话被清除时，写入审计记录。",
  "The Boss and the other report recipients are told on WhatsApp every time you start working as someone, and the audit trail records whether they were reached.": "每次您开始以他人身份工作，老板和其他报告接收人都会收到 WhatsApp 通知，审计记录也会记下他们是否收到。",
  "A wrong password, or an account that is switched off. Nobody was signed in. Only real accounts are written down — an email nobody holds is not. At most {n} tries for one account are written down each hour; if there are more, one line says so and this number is lower than the real tries.": "密码错误，或账号已停用。没有人登录成功。只记录真实账号——无人使用的邮箱不记录。同一账号每小时最多记录 {n} 次尝试；超过时只写一条说明，此数字会低于实际尝试次数。",
  "After {dev} wrong tries in {minutes} minutes a Developer sign-in is paused for the rest of that time ({staff} for staff). Counts only — an email or an address is never shown. While a Developer sign-in is paused, the sign-in page gives the same answer as for any wrong password, so it does not tell anyone which email is a Developer's.": "在 {minutes} 分钟内输错 {dev} 次后，开发者登录会在剩余时间内暂停（员工为 {staff} 次）。只显示数量——绝不显示邮箱或地址。开发者登录暂停期间，登录页面给出的回答与任何密码错误时相同，因此不会让人知道哪个邮箱属于开发者。",
};

export default catalog;
