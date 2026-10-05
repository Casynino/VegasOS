import { cn } from "@/lib/utils";
import { MediaFrame } from "../kit/media-frame";

type Img = { src: string; alt: string };

/**
 * The photograph beside a story: one calm landscape on phones; on desktop a second, smaller
 * portrait overlaps its lower corner like a print laid on a print. For paper-tone sections (the
 * inset's frame is the paper colour).
 */
export function StoryMedia({ main, inset, className }: { main: Img; inset?: Img | null; className?: string }) {
  return (
    <div className={cn("relative", inset && "lg:mb-12 lg:mr-8", className)}>
      <MediaFrame src={main.src} alt={main.alt} ratio="4/3" ratioLg="5/4" focal="50% 45%" sizes="(min-width: 1024px) 55vw, 100vw" />
      {inset && (
        <div className="absolute -bottom-12 -right-8 hidden w-[38%] border-[6px] border-[var(--pub-paper)] shadow-[0_24px_50px_-28px_rgb(0_0_0/0.6)] lg:block">
          <MediaFrame src={inset.src} alt={inset.alt} ratio="4/5" sizes="20vw" />
        </div>
      )}
    </div>
  );
}
