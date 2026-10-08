import { beforeAll, describe, expect, it } from "vitest";
import { englishT, makeT, type T } from "@/i18n/translate";
import { ALL_BUNDLES, loadCatalog } from "@/i18n/catalog";
import CONTENT_ZH from "@/i18n/content/zh-CN";
import { bookingMessage, checkoutMessage, guestsText, langLink, orderReceivedMessage, type Hotel, type Money, type StayFacts } from "./wa-messages";
import { orderFacts, orderMessageText } from "./order-messages";
import { invoiceMessage } from "./invoice-message";

/**
 * Guest messages in the guest's language: the same message, the same facts (amounts, references, rooms, links) —
 * only the words change. English stays exactly as it was.
 */

let zh: T;
beforeAll(async () => {
  // As on the server (getTFor): the hotel's content defaults, then the interface strings.
  zh = makeT("zh-CN", { ...CONTENT_ZH, ...(await loadCatalog("zh-CN", ALL_BUNDLES)) });
});

const hotel: Hotel = { name: "Vegas Luxury Hotel", phone: "+255 710 223 344", instagram: "https://instagram.com/vegas", tiktok: null };
const stay: StayFacts = {
  ref: "VLH-AB12", roomType: "Double Deluxe", rooms: null, checkIn: "Mon, 12 Oct 2026 · from 14:00", checkOut: "Wed, 14 Oct 2026 · by 10:00", nights: 2, guests: "2 adults",
};
const money: Money = { lines: [{ label: "Room", amount: 160000 }], total: 160000, paid: 50000, balance: 110000 };
const BOOKING_URL = "https://vegas.example/booking/VLH-AB12?token=tok123";

/** Words left in English in a Chinese message, apart from names, brands, references and links. */
function englishLeft(text: string, allowed: string[] = []) {
  let rest = text.replace(/https?:\/\/\S+/g, "");
  for (const a of ["Vegas Luxury Hotel", "WhatsApp", "Instagram", "TikTok", "TZS", "Wi-Fi", "VEGAS", ...allowed]) rest = rest.replaceAll(a, "");
  return rest.match(/[A-Za-z]{3,}/g) ?? [];
}

describe("guest messages in the guest's language", () => {
  it("keeps the English booking confirmation exactly as it was", () => {
    const text = bookingMessage({ hotel, name: "Asha Juma", kind: "RESERVED", stay, money, rate: 80000, bookingUrl: BOOKING_URL, payUrl: BOOKING_URL });
    expect(text).toBe([
      "Hello Asha,",
      "Your booking at Vegas Luxury Hotel is reserved.",
      "*YOUR BOOKING*\n• Booking Ref: VLH-AB12\n• Room Type: Double Deluxe\n• Check-in: Mon, 12 Oct 2026 · from 14:00\n• Check-out: Wed, 14 Oct 2026 · by 10:00\n• Nights: 2\n• Guests: 2 adults",
      "*BOOKING SUMMARY*\n• Room Rate: TZS 80,000/night\n• Room: TZS 160,000\n• Total: TZS 160,000\n• Paid: TZS 50,000\n• Balance: TZS 110,000",
      "*PAYMENT*\nStatus: PARTIALLY PAID",
      `View your booking & pay by mobile money:\n${BOOKING_URL}`,
      "Need assistance? Call or WhatsApp Reception:\n+255 710 223 344",
      "We look forward to welcoming you to Vegas Luxury Hotel.",
    ].join("\n\n"));
    // Passing the English translator is the same as passing none.
    expect(bookingMessage({ hotel, name: "Asha Juma", kind: "RESERVED", stay, money, rate: 80000, bookingUrl: BOOKING_URL, payUrl: BOOKING_URL }, englishT)).toBe(text);
  });

  it("writes the booking confirmation in Chinese with the same numbers, reference and link", () => {
    const zhStay: StayFacts = { ...stay, roomType: zh("Double Deluxe"), checkIn: zh("{date} · from {time}", { date: zh.date("2026-10-12"), time: "14:00" }),
      checkOut: zh("{date} · by {time}", { date: zh.date("2026-10-14"), time: "10:00" }), guests: guestsText(2, 0, zh) };
    const url = langLink(BOOKING_URL, zh);
    const text = bookingMessage({ hotel, name: "Asha Juma", kind: "CONFIRMED", stay: zhStay, money: { ...money, paid: 160000, balance: 0 }, rate: 80000, bookingUrl: url, payUrl: url }, zh);
    expect(text).toContain("您好，Asha！");
    expect(text).toContain("您在Vegas Luxury Hotel的预订已确认。");
    expect(text).toContain("*您的预订*");
    expect(text).toContain("• 预订编号：VLH-AB12");
    expect(text).toContain("• 房价：TZS 80,000/晚");
    expect(text).toContain("• 合计：TZS 160,000");
    expect(text).toContain("*付款*\n状态：已付款");
    expect(text).toContain("2026年10月12日");
    expect(text).toContain(`${BOOKING_URL}&lang=zh`);
    expect(text).toContain(`• 退房：${zh.date("2026-10-14")} · 10:00 前`);
    expect(englishLeft(text, ["Asha", "VLH"])).toEqual([]);
  });

  it("writes the order received in Chinese: the dish as ordered, the same order number and total", () => {
    const facts = orderFacts({
      number: "ORD-2026-00012", type: "DINE_IN", serviceFee: 0, total: 30000, settlement: "NOW", paymentStatus: "UNPAID",
      createdAt: new Date("2026-10-12T09:30:00Z"),
      items: [{ name: "Chicken curry", quantity: 2, lineTotal: 30000, nameI18n: { "zh-CN": "咖喱鸡" } }],
    }, "Table 3", "Africa/Dar_es_Salaam");
    const en = orderReceivedMessage({ hotel, name: "Li Wei", order: facts, trackUrl: "https://vegas.example/order/t1" });
    expect(en).toContain("• Order No: #12\n• Place: Table 3\n• Order Type: Eat here\n• Date: Mon 12 Oct, 12:30");
    expect(en).toContain("• Chicken curry × 2 — TZS 30,000");

    const text = orderReceivedMessage({ hotel, name: "Li Wei", order: facts, trackUrl: langLink("https://vegas.example/order/t1", zh) }, zh);
    expect(text).toContain("Vegas Luxury Hotel已收到您的订单。");
    expect(text).toContain("• 订单号：#12");
    expect(text).toContain("• 地点：3 号桌");
    expect(text).toContain("• 咖喱鸡 × 2 — TZS 30,000");
    expect(text).toContain("*合计*\nTZS 30,000");
    expect(text).toContain("12:30");
    expect(text).toContain("https://vegas.example/order/t1?lang=zh");
    expect(englishLeft(text, ["Li", "Wei"])).toEqual([]);
  });

  it("writes order steps in Chinese, and English exactly as before", () => {
    const v = { name: "Li", hotel: "Vegas Luxury Hotel", number: "ORD-2026-00012", type: "ROOM_SERVICE", room: "301", track: "https://t", menu: "https://m", prepMinutes: 20 };
    expect(orderMessageText("READY", v)).toContain("Your order #12 is ready and on its way to Room 301.");
    expect(orderMessageText("PREPARING", v)).toContain("Your order #12 is now being prepared. It should be ready in about 20 minutes.");
    const ready = orderMessageText("READY", v, zh);
    expect(ready).toContain("您的订单 #12 已备好，正在送往 301 号房。");
    expect(ready).toContain("• 地点：301 号房");
    expect(ready).toContain("• 状态：已备好");
    expect(orderMessageText("PREPARING", v, zh)).toContain("预计约 20 分钟后备好");
    expect(orderMessageText("CANCELLED", v, zh)).toContain("非常抱歉——您的订单 #12 已取消。");
  });

  it("writes the check-out message in Chinese with the final bill", () => {
    const text = checkoutMessage({
      hotel, name: "Asha", stay: { ...stay, rooms: "204" }, money: { lines: [{ label: "Room", amount: 160000 }, { label: "Restaurant", amount: 35000 }], total: 195000, paid: 195000, balance: 0 },
      stayUrl: langLink("https://vegas.example/stay/abc", zh), thanksUrl: langLink("https://vegas.example/thanks/xyz", zh),
    }, zh);
    expect(text).toContain("感谢您入住Vegas Luxury Hotel。您已办理退房。");
    expect(text).toContain("• 房间：204");
    expect(text).toContain("*最终账单*");
    expect(text).toContain("• 餐厅：TZS 35,000");
    expect(text).toContain("*付款状态*\n已全额付款");
    expect(text).toContain("https://vegas.example/thanks/xyz?lang=zh");
  });

  it("writes the invoice message in Chinese with the same invoice number and amounts", () => {
    const x = { hotelName: "Vegas Luxury Hotel", hotelPhone: "+255 710 223 344", greet: "Mr Chen", number: "INV-2026-0042", final: true, group: { name: "Sino Build", rooms: 3 }, net: 900000, paid: 300000, balance: 600000, due: "20 Oct 2026", verifyUrl: "https://vegas.example/verify/v1" };
    const en = invoiceMessage(x);
    expect(en).toContain("Dear Mr Chen,");
    expect(en).toContain("Your final invoice from Vegas Luxury Hotel for Sino Build (3 rooms).");
    expect(en).toContain("Please use INV-2026-0042 as the payment reference.");
    const text = invoiceMessage({ ...x, due: zh.date("2026-10-20") }, zh);
    expect(text).toContain("尊敬的Mr Chen：");
    expect(text).toContain("这是Vegas Luxury Hotel为Sino Build (3 间房)开具的最终发票。");
    expect(text).toContain("• 发票号：INV-2026-0042");
    expect(text).toContain("• 待付金额：TZS 600,000");
    expect(text).toContain("• 状态：部分付款");
    expect(text).toContain("付款时请以 INV-2026-0042 作为付款参考号。");
    expect(englishLeft(text, ["Chen", "Sino", "Build", "INV"])).toEqual([]);
  });

  it("opens the guest's links in their language, English links unchanged", () => {
    expect(langLink("https://x/stay/abc", englishT)).toBe("https://x/stay/abc");
    expect(langLink("https://x/stay/abc", zh)).toBe("https://x/stay/abc?lang=zh");
    expect(langLink("https://x/booking/R?token=t#pay", zh)).toBe("https://x/booking/R?token=t&lang=zh#pay");
    expect(langLink(null, zh)).toBeNull();
    expect(langLink("https://x/stay/abc?lang=zh", zh)).toBe("https://x/stay/abc?lang=zh");
  });
});
