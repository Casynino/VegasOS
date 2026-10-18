// Developer console: the Access page (who the Developer can work as, suspend, re-activate or sign out) and the words of its actions.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // the page
  "Access": "访问管理",
  "{n} account.": "{n} 个账号。",
  "{n} accounts.": "{n} 个账号。",
  "Pick a person and press Work as to open their dashboard exactly as they see it — without their password. Everything you do is recorded under your name.": "选择一位人员并点击“以此身份工作”，即可打开其仪表板，与对方看到的完全一致——无需对方密码。您所做的一切都会以您的名字记录。",
  "What the buttons do": "按钮的作用",
  "Opens that person's dashboard with their real permissions and data. A bar at the top shows who you are working as; press Stop to come back here. It ends by itself after 4 hours. Money is never touched: payments, revenue, expenses, withdrawals and purchases are refused while you work as someone.": "打开该人员的仪表板，使用其真实的权限和数据。顶部的状态栏会显示您正在以谁的身份工作；点击“停止”即可回到这里。4 小时后自动结束。绝不会触碰资金：以他人身份工作期间，收款、收入、支出、提现和采购付款都会被拒绝。",
  "Blocks the account and signs the person out until it is re-activated. You must write a reason and type CONFIRM. You can only re-activate accounts you suspended yourself.": "停用账号，并让对方退出登录，直到账号被重新启用。您必须写明原因并输入 CONFIRM。您只能重新启用由您自己停用的账号。",
  "Ends every open session on every phone and computer. The person can sign straight back in — useful if a phone was lost.": "结束该人员在所有手机和电脑上的登录。对方可以立即重新登录——手机丢失时很有用。",

  "Safety rules": "安全规则",
  "The Developer account cannot create or change accounts, passwords, login emails, roles or rights — only the Boss and the MD can, in Staff & roles. Here you can work as a person, suspend an account, sign a person out everywhere and switch back on an account you suspended yourself.": "开发者账号不能创建或更改账号、密码、登录邮箱、角色或权限——只有老板和总经理（MD）可以在“员工与角色”中操作。在这里您可以：以某人的身份工作、停用账号、让某人在所有设备上退出登录，以及重新启用由您自己停用的账号。",
  "While you work as someone you can't suspend people or sign them out of all devices either — so Work as can never be used to take over an account. Money stays untouchable too. The Boss is told every time you start, suspend or sign someone out.": "以他人身份工作期间，您同样不能停用他人或让他们退出所有设备——因此“以此身份工作”永远无法用来接管账号。资金同样无法触碰。每次您开始、停用或让某人退出登录时，老板都会收到通知。",

  // the people
  "Search by name, email or role": "按姓名、邮箱或角色搜索",
  "No one matches “{query}”.": "没有与“{query}”匹配的人员。",
  "There are no accounts to show.": "没有可显示的账号。",
  "account::Active": "已启用",
  "account::Suspended": "已停用",
  "Last signed in {when}": "最近登录：{when}",
  "Never signed in": "从未登录",
  "Work as": "以此身份工作",
  "Work as {name}": "以 {name} 的身份工作",
  "Suspend": "停用",
  "Suspend {name}": "停用 {name}",
  "Re-activate": "重新启用",
  "Re-activate {name}": "重新启用 {name}",
  "Sign out everywhere": "退出所有设备",
  "Sign {name} out everywhere": "让 {name} 退出所有设备",
  "Can't be suspended or signed out here": "此处不能停用或强制退出登录",
  "Only the Boss or the MD can switch this account back on": "只有老板或总经理可以重新启用此账号",

  // the dialogs
  "Suspend {name}?": "停用 {name}？",
  "{name} is signed out of every phone and computer at once and cannot sign in until the account is re-activated. You can only re-activate an account you suspended yourself.": "{name} 将立即退出所有手机和电脑上的登录，在账号重新启用之前无法登录。您只能重新启用由您自己停用的账号。",
  "Type CONFIRM to go on": "输入 CONFIRM 以继续",
  "Re-activate {name}?": "重新启用 {name}？",
  "{name} can sign in again with the same email and password.": "{name} 可以用原来的邮箱和密码重新登录。",
  "Sign {name} out everywhere?": "让 {name} 退出所有设备？",
  "Ends every open session on every phone and computer. The person can sign straight back in.": "结束该人员在所有手机和电脑上的登录。对方可以立即重新登录。",

  // the actions
  "Write a reason of at least 5 characters.": "请写明原因，至少 5 个字符。",
  "Keep the reason under 500 characters.": "原因请控制在 500 个字符以内。",
  "Type CONFIRM, in capital letters, to go on.": "请输入大写的 CONFIRM 以继续。",
  "Account suspended. The person is signed out and cannot sign in.": "账号已停用。对方已退出登录，无法再登录。",
  "Account re-activated. The person can sign in again.": "账号已重新启用。对方可以再次登录。",
  "Signed out everywhere. The person can sign straight back in.": "已让对方退出所有设备。对方可以立即重新登录。",
};

export default catalog;
