import { cn } from "@/lib/utils";

/**
 * The small tag that sits NEXT TO the name of whoever did something, when the Developer did it while working as someone (owner, 2026-10-18).
 * The text arrives already translated ("Done by Developer" or "Done by Developer · as Neema"), so the same tag works in a server component, a
 * client component and a list that was prepared on the server. Never put the tag inside the name: some screens cut a name at the first bracket.
 */
export function DoneByDeveloper({ text, className }: { text: string; className?: string }) {
  return <span className={cn("ml-1.5 inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-violet-500/15 px-2 py-0.5 align-middle text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:text-violet-300", className)}>{text}</span>;
}
