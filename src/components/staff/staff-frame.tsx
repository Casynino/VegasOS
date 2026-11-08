"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { GlassSidebar, type SidebarProps } from "./glass-sidebar";
import { AtWidth } from "./at-width";
import { SIDEBAR_COOKIE, SIDEBAR_ROOM } from "@/lib/sidebar";

/**
 * The computer's frame: the floating glass side menu (full or folded to an icon rail) and, beside it, the page — which leaves exactly the
 * room the panel takes. Folding is remembered in a cookie the server reads, so a folded menu is folded on the first paint.
 * A phone has no side panel here: its menu is the drawer (bottom bar).
 */
export function StaffFrame({ initialCollapsed, sidebar, bell, children }: { initialCollapsed: boolean; sidebar: SidebarProps; bell: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const fold = (next: boolean) => {
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "rail" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <>
      <GlassSidebar mode="desktop" sidebar={sidebar} bell={<AtWidth wide>{bell}</AtWidth>} collapsed={collapsed} onCollapsedChange={fold} />
      <div className="flex min-w-0 flex-1 flex-col transition-[padding] duration-200 motion-reduce:transition-none lg:pl-[var(--sidebar-room)] print:pl-0"
        style={{ "--sidebar-room": collapsed ? SIDEBAR_ROOM.rail : SIDEBAR_ROOM.open } as CSSProperties}>
        {children}
      </div>
    </>
  );
}
