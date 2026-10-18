"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Shows its children only on one page. The staff layout is not drawn again when somebody moves between pages, so the layout cannot know which
 * page is open; this small client piece reads the address in the browser (owner, 2026-10-19: the guide book strip is for the home page only).
 */
export function OnlyOnPath({ path, children }: { path: string; children: ReactNode }) {
  return usePathname() === path ? <>{children}</> : null;
}
