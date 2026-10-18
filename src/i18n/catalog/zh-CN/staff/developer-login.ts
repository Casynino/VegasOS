// Developer account: the names of its role and rights, and the strip shown on every staff page. (The sign-in is one plain door: no choice of account type.)
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Account kinds (named in the audit trail and the Users page)
  "Account type": "账号类型",
  "Staff account": "员工账号",
  "Developer account": "开发者账号",

  // The strip on every page while a Developer is signed in
  // The role's name, shown beside the picture in the top bar and in the phone menu
  "Developer (super user)": "开发者（超级用户）",

  // What the two new rights and the Developer role are called in the Users page (permission matrix / role list)
  "Developer super user: the developer console and system diagnostics. Held only by the Developer role — never by the Boss, the MD or any staff role": "开发者超级用户：开发者控制台和系统诊断。仅开发者角色拥有，老板、总经理及任何员工角色都不具备",
  "The system's developer: sees and troubleshoots every department, the settings, the staff accounts and the audit trail, with every action recorded as a Developer action. Cannot record, reverse, approve, pay or withdraw money. Created only by a controlled setup — never from the Users page.": "系统开发者：可查看并排查各部门、设置、员工账号和审计记录，所有操作都记为开发者操作。不能登记、冲销、批准、支付或提取资金。仅通过受控的设置程序创建，不能在“用户”页面创建。",
};

export default catalog;
