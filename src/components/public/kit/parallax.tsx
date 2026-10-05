"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Scroll-linked drift for a photo inside a clipping frame: the layer moves from -strength% to
 * +strength% of its height while the frame crosses the viewport, and is scaled just enough to
 * never show an edge. Transform only (compositor), off with reduced motion. MediaFrame uses it
 * through `parallax`; use it directly around any absolutely positioned media.
 */
export function ParallaxLayer({
  strength = 7,
  className,
  children,
}: {
  /** Percent of the frame height travelled each way (4–10 reads well). */
  strength?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [`${-strength}%`, `${strength}%`]);
  return (
    <div ref={ref} className={cn("absolute inset-0 overflow-hidden", className)}>
      {/* Same markup on server and client; reduced motion switches the transform off in CSS. */}
      <motion.div className="absolute inset-0 motion-reduce:transform-none!" style={{ y, scale: 1 + (strength * 2.1) / 100 }}>
        {children}
      </motion.div>
    </div>
  );
}
