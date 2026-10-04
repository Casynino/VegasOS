"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Friendly error screen for the staff area; technical details go to the server/console logs only. */
export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle /></span>
      <h1 className="mt-4 text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page couldn&apos;t load. Nothing was changed. Please try again{error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
      <Button className="mt-6" onClick={reset}><RotateCcw /> Try again</Button>
    </div>
  );
}
