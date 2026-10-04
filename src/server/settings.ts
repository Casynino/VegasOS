import "server-only";
import { cache } from "react";
import { db, type Tx } from "./db";
import type { HotelSettings } from "@/generated/prisma/client";
import { businessDateOf, type BusinessDate, type BusinessDayConfig } from "@/lib/time/business-date";
import type { StayConfig } from "@/lib/time/stay";

/** HotelSettingsService — the only reader of the singleton settings row. */
export const getSettings = cache(async (): Promise<HotelSettings> => {
  const row = await db.hotelSettings.findUnique({ where: { id: 1 } });
  if (row) return row;
  return db.hotelSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
});

export async function getSettingsTx(tx: Tx): Promise<HotelSettings> {
  const row = await tx.hotelSettings.findUnique({ where: { id: 1 } });
  return row ?? tx.hotelSettings.create({ data: { id: 1 } });
}

export function businessDayConfig(s: HotelSettings): BusinessDayConfig {
  return { timezone: s.timezone, businessDayStartMinutes: s.businessDayStartMinutes };
}

export function stayConfig(s: HotelSettings): StayConfig {
  return {
    timezone: s.timezone,
    businessDayStartMinutes: s.businessDayStartMinutes,
    standardCheckInMinutes: s.standardCheckInMinutes,
    checkoutMinutes: s.checkoutMinutes,
    lateArrivalMinutes: s.lateArrivalMinutes,
  };
}

/** Current hotel business date according to settings. */
export async function businessToday(now: Date = new Date()): Promise<BusinessDate> {
  const s = await getSettings();
  return businessDateOf(now, businessDayConfig(s));
}

export async function businessDateFor(instant: Date): Promise<BusinessDate> {
  const s = await getSettings();
  return businessDateOf(instant, businessDayConfig(s));
}
