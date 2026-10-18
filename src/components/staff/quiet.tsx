"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether this session is a quiet one (a Developer's — see src/lib/quiet.ts): every background timer that talks to the server or refreshes the
 * page reads this and does not start when it is true. Set once by the staff layout; outside it (the public pages) it is false.
 */
const QuietContext = createContext(false);

export function QuietProvider({ quiet, children }: { quiet: boolean; children?: ReactNode }) {
  return <QuietContext.Provider value={quiet}>{children}</QuietContext.Provider>;
}

/** True when background timers must stay off (a Developer's session). */
export const useQuiet = (): boolean => useContext(QuietContext);
