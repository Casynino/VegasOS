import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation } from "@/server/services/reservations";
import { reservationMessage } from "@/server/services/guest-message-data";
import { setGuestLanguage } from "@/server/services/guests";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const ARR = "2026-11-10", DEP = "2026-11-12";
const NOW = eat("2026-11-01T10:00:00");
const ORIGIN = "https://vegas.example";

async function booking(fullName: string, phone: string) {
  const mgr = await managerActor();
  const st = await roomType("DOUBLE_DELUXE");
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName, phone }, stay: { kind: "overnight", arrivalDate: ARR, departureDate: DEP },
    rooms: [{ roomTypeId: st.id, adults: 2, children: 0 }],
  }, mgr, NOW);
  return { mgr, r: await db.reservation.findUniqueOrThrow({ where: { id: r.id } }) };
}

describe("guest messages in the guest's language", () => {
  it("a guest with no language gets the booking message in English, exactly as before", async () => {
    const { r } = await booking("Neema Mushi", "0715 000 222");
    const m = (await reservationMessage(r.id, "BOOKING", ORIGIN))!;
    expect(m.locale).toBe("en");
    expect(m.text.startsWith("Hello Neema,\n\nYour booking at ")).toBe(true);
    expect(m.text).toContain(`• Booking Ref: ${r.reference}`);
    expect(m.text).toContain("• Guests: 2 adults");
    expect(m.text).not.toContain("lang=zh");
    expect(m.subject).toContain(`Your booking ${r.reference} — `);
  });

  it("a Chinese guest gets the same booking in Chinese — same reference and amounts, links that open in Chinese", async () => {
    const { r } = await booking("Li Wei", "0715 000 333");
    await db.guest.update({ where: { id: r.guestId }, data: { preferredLanguage: "zh-CN" } });
    const m = (await reservationMessage(r.id, "BOOKING", ORIGIN))!;
    expect(m.locale).toBe("zh-CN");
    expect(m.text.startsWith("您好，Li！")).toBe(true);
    expect(m.text).toContain("*您的预订*");
    expect(m.text).toContain(`• 预订编号：${r.reference}`);
    expect(m.text).toContain("• 入住人数：2 位成人");
    expect(m.text).toContain(`TZS ${r.netAmount.toLocaleString("en-US")}`);
    expect(m.text).toContain(`${ORIGIN}/booking/${r.reference}?token=${encodeURIComponent(r.manageToken)}&lang=zh`);
    expect(m.subject).toContain(`您的预订 ${r.reference}`);
    // The English for the same booking is untouched.
    await db.guest.update({ where: { id: r.guestId }, data: { preferredLanguage: null } });
    expect((await reservationMessage(r.id, "BOOKING", ORIGIN))!.text.startsWith("Hello Li,")).toBe(true);
  });

  it("staff set the message language on the customer — kept in the history like any guest change", async () => {
    const { mgr, r } = await booking("Chen Jie", "0715 000 444");
    expect(await setGuestLanguage(r.guestId, "zh-CN", mgr)).toEqual({ changed: true });
    expect(await setGuestLanguage(r.guestId, "zh-CN", mgr)).toEqual({ changed: false });
    expect((await db.guest.findUniqueOrThrow({ where: { id: r.guestId } })).preferredLanguage).toBe("zh-CN");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "guest.updated", entityId: r.guestId } });
    expect(log.before).toEqual({ preferredLanguage: null });
    expect(log.after).toEqual({ preferredLanguage: "zh-CN" });

    await setGuestLanguage(r.guestId, null, mgr);
    expect((await db.guest.findUniqueOrThrow({ where: { id: r.guestId } })).preferredLanguage).toBeNull();
    // @ts-expect-error — only the platform's languages
    await expect(setGuestLanguage(r.guestId, "fr", mgr)).rejects.toThrow(/Choose a language/);
  });
});
