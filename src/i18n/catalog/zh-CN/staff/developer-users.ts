// Developer account: what the account rules (server/services/staff-accounts.ts) say when they refuse a change.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "Give the reason for this change (at least 5 characters).": "请填写此次更改的原因（至少 5 个字符）。",
  "Give the reason (at least 5 characters).": "请填写原因（至少 5 个字符）。",
  "The reason is too long.": "原因太长。",
  "The Developer account is made only by the setup script — it cannot be given here.": "开发者账号只能通过设置脚本创建，不能在此授予。",
  "That right belongs to the Developer role alone — it cannot be given to or taken from any role here.": "该权限仅属于开发者角色，不能在此授予任何角色或从任何角色收回。",
  "The Developer role's rights cannot be changed here.": "不能在此更改开发者角色的权限。",
  "Reason for the change": "更改原因",
  "Why are you changing a right? (at least 5 characters)": "为什么要更改此权限？（至少 5 个字符）",
  "As a Developer you give a reason for every change. It is written in the audit trail with the change.": "作为开发者，每次更改都需要填写原因。原因会连同此次更改一起记入审计记录。",
  "Audit": "审计",
  "Reason (written in the audit trail)": "原因（会记入审计记录）",
  "At least 5 characters": "至少 5 个字符",
  "Needed when you change the role, the email, or switch the account on or off.": "更改角色、邮箱，或启用/停用账号时必须填写。",
  "The Developer account cannot do this: it would give access to money. Ask the Boss or the MD.": "开发者账号不能这样做：这会带来资金方面的权限。请联系老板或总经理（MD）。",
  "The Developer account cannot give this right: it is about money. Ask the Boss or the MD.": "开发者账号不能授予此权限：它涉及资金。请联系老板或总经理（MD）。",
  "The Developer account cannot give the right to manage staff accounts. Ask the Boss or the MD.": "开发者账号不能授予管理员工账号的权限。请联系老板或总经理（MD）。",
  "The Developer account cannot take away the right to see the audit trail. Ask the Boss or the MD.": "开发者账号不能收回查看审计记录的权限。请联系老板或总经理（MD）。",
  "A Developer password is changed only with the setup script, not here.": "开发者密码只能通过设置脚本更改，不能在此更改。",
  "This email cannot be used.": "无法使用此邮箱。",
  "The Developer account cannot change rights about money or staff accounts, or take away the audit-trail right. Those switches are fixed: ask the Boss or the MD.": "开发者账号不能更改涉及资金或员工账号的权限，也不能收回审计记录权限。这些开关已固定：请联系老板或总经理（MD）。",
  "This account has access to money. The Developer account can change its name and phone and switch it off — nothing else. Ask the Boss or the MD.": "此账号有资金方面的权限。开发者账号只能修改其姓名和电话，或将其停用，不能做其他更改。请联系老板或总经理（MD）。",
};

export default catalog;
