"use client";

import { useEffect } from "react";

/**
 * The staff system (admin, manager, reception, restaurant…) is always dark — one look for
 * every back-office screen; only the public website lets visitors pick light or dark.
 * Dialogs and sheets render outside the shell, so the page root is dark too while here.
 */
export function StaffDarkMode() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    // pop-ups and menus are drawn outside the shell too: the app-like touch rules in globals.css hang on this mark
    root.dataset.staff = "1";
    return () => { root.classList.remove("dark"); delete root.dataset.staff; };
  }, []);
  return null;
}
