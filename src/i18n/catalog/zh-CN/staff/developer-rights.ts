// Developer account: what the Developer role may hold (src/lib/permissions.ts) and what the server says when a Developer's settings change is refused.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // The Developer role's description (Users page / role list)
  "The system's developer: sees and troubleshoots every department, the settings, the staff accounts and the audit trail, with every action recorded as a Developer action. Cannot record, change, approve, pay, reverse or void money, decide what a guest or supplier owes, or change where guests pay or the money limits. Created only by a controlled setup — never from the Users page.":
    "系统开发者：可查看并排查各部门、设置、员工账号和审计记录，所有操作都记为开发者操作。不能登记、更改、批准、支付、冲销或作废资金，不能决定客人或供应商应付多少，也不能更改客人付款的账户或资金额度。仅通过受控的设置程序创建，不能在“用户”页面创建。",

  // Saving the hotel settings as a Developer
  "Say why you are changing the settings (at least 5 characters).": "请说明为何更改设置（至少 5 个字符）。",
  "Required — at least 5 characters": "必填 — 至少 5 个字符",
  "The Developer account cannot change where guests pay, the approval limits, the fees and policies that decide what a guest owes, or where the reports go. Ask the Boss or the MD to change them.":
    "开发者账号不能更改客人付款的账户、审批额度、决定客人应付金额的费用和政策，也不能更改报告的发送对象。请联系老板或总经理（MD）更改。",
  "Boss or MD only": "仅限老板或总经理",
  "The Developer account cannot change the payment methods. Ask the Boss or the MD.": "开发者账号不能更改付款方式。请联系老板或总经理（MD）。",
};

export default catalog;
