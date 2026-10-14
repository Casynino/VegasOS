// Developer account: the money wall. What the Developer is told when it tries a decision about money (a discount, free nights,
// leaving owing, billing a room, a price, a limit…). The same sentence is said by the server actions (auth.ts) and the services (developer-wall.ts).
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "The Developer account cannot make this decision. Use the Boss, the MD or a manager account.": "开发者账号不能做这项决定。请使用老板、总经理或经理账号。",
};

export default catalog;
