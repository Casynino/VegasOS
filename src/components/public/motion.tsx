"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { animate, motion, MotionConfig, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Counts up to a real number once visible. Renders the final value on the server. */
export function CountUp({ value, className, suffix = "" }: { value: number; className?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!inView || reduce || value <= 1) return;
    const controls = animate(0, value, {
      duration: 1.6,
      ease: EASE,
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, reduce, value]);
  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">{shown}{suffix}</span>
      <span className="sr-only">{value}{suffix}</span>
    </span>
  );
}

/** Infinite horizontal marquee; a static wrapped row when reduced motion is on. */
export function Marquee({ children, className, duration = 40 }: { children: React.ReactNode; className?: string; duration?: number }) {
  return (
    <div className={cn("relative overflow-hidden motion-safe:[mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]", className)}>
      <motion.div
        className="flex w-max gap-10 pr-10 motion-reduce:w-full motion-reduce:justify-center motion-reduce:pr-0"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration, ease: "linear", repeat: Infinity }}
      >
        <div className="flex shrink-0 gap-10 motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-4">{children}</div>
        <div className="flex shrink-0 gap-10 motion-reduce:hidden" aria-hidden="true">{children}</div>
      </motion.div>
    </div>
  );
}

/** Honour the OS "reduce motion" setting for every motion component on the site. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * Full-bleed hero photo with a settle and scroll parallax (currently unused — the kit's
 * MediaFrame with `preload` + the .pub-settle class is the lighter default for heroes).
 */
export function HeroImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "18%"]);
  return (
    <div ref={ref} className={cn("absolute inset-0 -z-10 overflow-hidden", className)}>
      <motion.div style={{ y }} className="absolute inset-0">
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.06 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.6, ease: EASE }}
        >
          <Image src={src} alt={alt} fill preload sizes="100vw" className="object-cover" />
        </motion.div>
      </motion.div>
    </div>
  );
}
