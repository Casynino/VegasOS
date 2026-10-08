import type { Catalog } from "../../../translate";

// Common requests a customer ticks when ordering (src/lib/order-requests.ts) — read by customers and staff alike.
const catalog: Catalog = {
  "No onions": "不要洋葱",
  "No garlic": "不要大蒜",
  "Not spicy": "不要辣",
  "Extra spicy": "加辣",
  "No ice": "不加冰",
  "Less sugar": "少糖",
  "No sugar": "无糖",
  "Meat well done": "肉要全熟",
  "Sauce on the side": "酱汁另放",
  "Vegetarian": "素食",
  "I have an allergy — please ask me": "我有过敏 — 请先问我",
  "Pack it to take away": "打包带走",
};
export default catalog;
