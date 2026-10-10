import type { Catalog } from "../../../translate";

/** Fixes after the Chinese crawl — customers, groups, assets, staff sign-in (people-misc). */
const catalog: Catalog = {
  // Contact channel
  "SMS": "短信",
  // Stand-in names the system saves when a customer gave no name, or was removed
  "Restaurant customer": "餐厅顾客",
  "Table guest": "餐桌客人",
  "Removed customer": "已移除顾客",
  // A guest request that is not done yet (customer profile)
  "request::Open": "待处理",
  // Example e-mail addresses in empty fields
  "you@vegashoteltz.com": "您的酒店工作邮箱",
  "accounts@company.co.tz": "公司财务邮箱",
};

export default catalog;
