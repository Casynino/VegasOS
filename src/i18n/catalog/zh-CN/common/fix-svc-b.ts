import type { Catalog } from "../../../translate";

// Fixes in the server services (svc-b) shown on staff screens: what a guest asked for from their phone, kept as the
// request's description (requests.ts) — shown in the reader's language where the screen wraps it with t().
const catalog: Catalog = {
  "Please clean the room": "请打扫房间",
  "The guest needs help": "客人需要帮助",
};
export default catalog;
