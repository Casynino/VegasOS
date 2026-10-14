// The Audit trail page (Boss, MD, Developer): the read-only record of who did what, with Developer actions marked.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Menu and page
  "Audit trail": "审计记录",
  "Developer console": "开发者控制台",
  "Who did what, and when: Developer, staff, system and website actions. Read-only — no entry can be changed or deleted.": "谁在何时做了什么：开发者、员工、系统和官网的所有操作。仅可查看 — 任何记录都不能被修改或删除。",
  "Times are in the hotel's time zone ({zone}). Newest first.": "时间均为酒店所在时区（{zone}）。最新的在前。",

  // Filters
  "Filter the audit trail": "筛选审计记录",
  "Who acted": "操作者类型",
  "Developer": "开发者",
  "System & website": "系统与官网",
  "Action contains": "操作包含",
  "e.g. payment, login, user": "例如：payment、login、user",
  "Module": "模块",
  "All modules": "全部模块",
  "One search covers at most {days} days — showing the {days} days up to {to}.": "一次搜索最多涵盖 {days} 天 — 现显示截至 {to} 的 {days} 天。",

  // The list
  "No entries found": "没有找到记录",
  "Try other dates, or clear the filters.": "请换个日期，或清除筛选。",
  "This is as far back as one search goes ({pages} pages). Choose closer dates to see older entries.": "一次搜索最多只能翻到这里（{pages} 页）。请选择更近的日期来查看更早的记录。",
  "Pages": "分页",
  "Page {page}": "第 {page} 页",
  "{n} entry shown": "显示 {n} 条记录",
  "{n} entries shown": "显示 {n} 条记录",

  // One entry
  "Exact time": "精确时间",
  "Business day": "营业日",
  "IP address": "IP 地址",
  "Reason given": "所填原因",
  "What went wrong": "出错原因",
  "(shortened)": "（已截短）",

  // Actions in plain words (who + these words: "Asha — failed to sign in")
  "failed to sign in": "登录失败",
  "was refused — no permission": "被拒绝 — 没有权限",
  "looked at a page": "查看了页面",
  "checked what a person can do": "检查了某人的权限",
  "set up the Developer account": "设置了开发者账号",
  "changed the Developer password": "更改了开发者密码",
  "switched the Developer account off": "停用了开发者账号",
  "added a staff account": "添加了员工账号",
  "removed a staff account": "删除了员工账号",
  "reset a password": "重置了密码",
  "could not add a staff account": "未能添加员工账号",
  "could not change a staff account": "未能修改员工账号",
  "could not reset a password": "未能重置密码",
  "could not change a role's rights": "未能修改角色权限",
  "could not remove a staff account": "未能删除员工账号",
  "had a withdrawal refused": "提现被拒绝",
  "set up the team's sign-ins": "设置了团队的登录账号",
};

export default catalog;
