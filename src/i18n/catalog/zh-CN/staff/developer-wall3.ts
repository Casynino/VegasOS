// Developer account, third review of the wall: the Boss's notice about a suspension and a sign-out, and re-activation (services/work-as.ts).
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Re-activation (services/work-as.ts REACTIVATE_REFUSAL — also in the failed attempt's audit entry)
  "The Developer account cannot switch this account back on: its role holds rights about money or accounts. Ask the Boss or the MD.": "开发者账号不能重新启用此账号：其角色拥有涉及资金或账号管理的权限。请联系老板或总经理（MD）。",
  // The audit trail's words for the notice to the Boss
  "Notice to the Boss about a change to a staff account": "就员工账号的变更一事通知老板",
  "Notice to the Boss about a change to the account of {person}": "就 {person} 的账号变更一事通知老板",
  // The Boss's WhatsApp notices (services/work-as.ts)
  "{developer} (Developer) suspended {person} ({role}) at {time}. Reason: {reason}. You can switch the account back on in Staff & roles.": "{developer}（开发者）已于 {time} 停用 {person}（{role}）的账号。原因：{reason}。您可以在“员工与角色”中重新启用该账号。",
  "{developer} (Developer) signed {person} ({role}) out of every phone and computer at {time}. They can sign straight back in.": "{developer}（开发者）已于 {time} 让 {person}（{role}）在所有手机和电脑上退出登录。此人可以立即重新登录。",
};

export default catalog;
