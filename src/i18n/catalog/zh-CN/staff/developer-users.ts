// Developer account: what the account rules (server/services/staff-accounts.ts, services/work-as.ts) say when they refuse a change.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "Give the reason for this change (at least 5 characters).": "请填写此次更改的原因（至少 5 个字符）。",
  "Give the reason (at least 5 characters).": "请填写原因（至少 5 个字符）。",
  "The reason is too long.": "原因太长。",
  "The Developer account cannot create or change accounts, passwords, roles or rights. Ask the Boss or the MD.": "开发者账号不能创建或更改账号、密码、角色或权限。请联系老板或总经理（MD）。",
  "That right belongs to the Developer role alone — it cannot be given to or taken from any role here.": "该权限仅属于开发者角色，不能在此授予任何角色或从任何角色收回。",
  "Audit": "审计",
  "Reason (written in the audit trail)": "原因（会记入审计记录）",
  "At least 5 characters": "至少 5 个字符",
};

export default catalog;
