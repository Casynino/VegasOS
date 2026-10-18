// Developer account, session fixes (round 3): the words that changed. (The Developer's password hint was already in developer-session2.ts
// and is reused as it is.)
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // What the "see the audit trail" right is called on the Users page (permission matrix). The old wording ("nobody can change or delete it")
  // promised more than the database lock does: the Audit page names the one exception.
  "See the full audit trail: who did what, when, as a Developer or as staff (read-only; the database refuses any change or delete — the Audit page names the one exception)":
    "查看完整审计记录：谁在何时做了什么，是开发者操作还是员工操作（只读；数据库会拒绝任何修改或删除——审计页面注明了唯一的例外）",
};
export default catalog;
