// The Developer and shifts: what the server says when a Developer tries to start, end, close or re-plan a person's shift (server/shift-wall.ts).
// (The money refusals themselves — "The Developer account cannot make this decision…" — are translated in developer-gates.ts.)
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // While working as someone (the words of assertNotWorkAs)
  "While you are working as someone you cannot start or end a shift.": "以他人身份工作期间，您不能开始或结束班次。",
  "While you are working as someone you cannot close someone's shift.": "以他人身份工作期间，您不能关闭他人的班次。",
  "While you are working as someone you cannot change the shift plan.": "以他人身份工作期间，您不能更改排班计划。",
  // The Developer's own account has no shift
  "The Developer account cannot start or end a shift.": "开发者账号不能开始或结束班次。",
  "The Developer account cannot close someone's shift.": "开发者账号不能关闭他人的班次。",
};

export default catalog;
