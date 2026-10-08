import type { Catalog } from "../../../translate";

// Fixes after the Chinese crawl — the guest's stay page (stay link / room QR card): the WhatsApp message to reception,
// prefilled in the guest's language.
const catalog: Catalog = {
  "Hello, this is {name} in {place}.": "您好，我是{place}的{name}。",
  "Hello, this is {name} (booking {reference}).": "您好，我是{name}（预订号 {reference}）。",
};
export default catalog;
