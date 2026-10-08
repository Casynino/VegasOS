import type { Catalog } from "../../../translate";

// The shared building blocks (dialogs, sheets, toasts, calendar, command palette, language switch, mobile-money marks)
// — on the website, the guest pages and in the staff app alike.
const catalog: Catalog = {
  // Dialogs and sheets
  "Close": "关闭",
  "Command Palette": "命令面板",
  "Search for a command to run...": "搜索要执行的命令…",

  // Toasts
  "Notifications": "通知",
  "Close toast": "关闭通知",

  // Language switch
  "Language": "语言",
  "Language: {language}": "语言：{language}",

  // Mobile-money networks
  "Works with": "支持",
  "Mobile-money networks": "手机支付网络",
};
export default catalog;
