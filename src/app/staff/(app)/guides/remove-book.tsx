"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { removeGuideBookAction } from "./actions";

/** The Developer takes one book out of the file storage (asked once, in plain words; written to the audit trail). */
export function RemoveBook({ file, title }: { file: string; title: string }) {
  const t = useT();
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = useRef(true);
  const removeButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  // Keyboard users stay where they were: the button that is shown next gets the focus (not on the first paint).
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    (sure ? confirmButton : removeButton).current?.focus();
  }, [sure]);
  const go = () => start(async () => {
    const res = await removeGuideBookAction(file);
    if (res.ok) router.refresh(); else setError(res.error);
  });
  if (!sure) return <button ref={removeButton} type="button" onClick={() => { setError(null); setSure(true); }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"><Trash2 className="size-3.5" aria-hidden />{t("Remove")}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("Remove {title}?", { title })}</span>
      <button ref={confirmButton} type="button" onClick={go} disabled={pending} className="font-medium text-rose-600 hover:underline disabled:opacity-60 dark:text-rose-400">{t("Yes, remove")}</button>
      <button type="button" onClick={() => setSure(false)} className="text-muted-foreground hover:underline">{t("No")}</button>
      {error && <span role="alert" className="text-rose-600 dark:text-rose-400">{error}</span>}
    </span>
  );
}
