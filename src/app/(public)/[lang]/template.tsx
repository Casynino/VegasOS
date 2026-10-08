import { ViewTransition } from "react";

/** Soft page transition between public routes (View Transitions API; no-op where unsupported). */
export default function PublicTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="vlh-page" exit="vlh-page" default="none">
      <div className="flex flex-1 flex-col">{children}</div>
    </ViewTransition>
  );
}
