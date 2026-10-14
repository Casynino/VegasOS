// Developer account: the sign-in choice (Staff account / Developer account) and the identity strip shown on every staff page.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Sign-in choice
  "Account type": "账号类型",
  "Staff account": "员工账号",
  "Developer account": "开发者账号",
  "Developer access only": "仅限开发者",
  "Developer sign-in — every action is recorded as a Developer action.": "开发者登录 — 每一步操作都会记为开发者操作。",
  "Incorrect email or password for this account type.": "此账号类型的邮箱或密码不正确。",

  // The strip on every page while a Developer is signed in
  "DEVELOPER MODE — SUPER USER": "开发者模式 — 超级用户",
  "Switch to a staff account": "切换到员工账号",
  // The role's name, shown beside the picture in the top bar and in the phone menu
  "Developer (super user)": "开发者（超级用户）",

  // What the two new rights and the Developer role are called in the Users page (permission matrix / role list)
  "See the full audit trail: who did what, when, as a Developer or as staff (read-only; nobody can change or delete it)": "查看完整审计记录：谁在何时做了什么，是开发者操作还是员工操作（只读；任何人都无法修改或删除）",
  "Developer super user: the developer console and system diagnostics. Held only by the Developer role — never by the Boss, the MD or any staff role": "开发者超级用户：开发者控制台和系统诊断。仅开发者角色拥有，老板、总经理及任何员工角色都不具备",
  "The system's developer: sees and troubleshoots every department, the settings, the staff accounts and the audit trail, with every action recorded as a Developer action. Cannot record, reverse, approve, pay or withdraw money. Created only by a controlled setup — never from the Users page.": "系统开发者：可查看并排查各部门、设置、员工账号和审计记录，所有操作都记为开发者操作。不能登记、冲销、批准、支付或提取资金。仅通过受控的设置程序创建，不能在“用户”页面创建。",
};

export default catalog;
