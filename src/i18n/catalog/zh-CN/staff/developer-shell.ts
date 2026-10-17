// Developer account: the strip shown while a Developer works as someone, the console's menu names, and the bell's note while working as someone.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // The strip on every page while a Developer works as someone (the person's own name and role are never translated)
  "DEVELOPER MODE — you are working as {name} ({role})": "开发者模式 — 当前以 {name}（{role}）的身份操作",
  "Started {elapsed} ago · ends in {left}": "已开始 {elapsed} · {left}后自动结束",
  "less than a minute": "不到 1 分钟",
  "Stop": "停止",
  // The plain Developer strip's link to the console
  "Console": "控制台",

  // The Developer console's menu (the section heading is "Developer console")
  "nav::Audit": "审计",
  "nav::Business": "业务",
  "nav::Access": "访问管理",

  // The alert bell while working as someone
  "The sound is the person's own choice — it cannot be changed while you are working as them.": "提示音由本人自行设置 — 以其身份操作时无法更改。",
};

export default catalog;
