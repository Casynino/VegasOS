"use client";

import { useEffect } from "react";

/**
 * The staff system (admin, manager, reception, restaurant…) is always dark — one look for
 * every back-office screen; only the public website lets visitors pick light or dark.
 * Dialogs and sheets render outside the shell, so the page root is dark too while here.
 */
export function StaffDarkMode() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => { document.documentElement.classList.remove("dark"); };
  }, []);
  return null;
}
