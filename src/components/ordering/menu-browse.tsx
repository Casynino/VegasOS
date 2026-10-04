"use client";

import { MenuPicker, useBasket, type OrderMenuSection } from "./menu-picker";

/** The live menu to look at only (no ordering) — e.g. a free room's QR. */
export function MenuBrowse({ sections, subtitle }: { sections: OrderMenuSection[]; subtitle: React.ReactNode }) {
  const b = useBasket(sections);
  return <MenuPicker sections={sections} basket={b.basket} setQty={b.setQty} canOrder={false} title="Our menu" subtitle={subtitle} />;
}
