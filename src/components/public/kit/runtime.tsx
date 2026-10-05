"use client";

import { useEffect } from "react";

const WATCH = "[data-live-watch]";
const SPOT = "[data-spotlight]";

/**
 * The public site's one tiny runtime (mounted once in the public layout — pages never add it):
 *
 * 1. Live bands: every element with `data-live-watch` (atmosphere layers, marquees) gets
 *    `data-live` while it is on screen (± 15%), so its CSS animation runs only then. One shared
 *    IntersectionObserver; elements added later (client navigation, steps) are picked up by a
 *    MutationObserver.
 * 2. Cursor spotlight: on fine pointers only, elements with `data-spotlight` get --mx/--my and
 *    `data-spot-on` while hovered (one delegated, rAF-throttled pointermove listener).
 */
export function PubRuntime() {
  useEffect(() => {
    const root = document.querySelector(".pub-site") ?? document.body;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.toggleAttribute("data-live", e.isIntersecting);
      },
      { rootMargin: "15% 0px 15% 0px" },
    );
    const watched = new Set<Element>();
    const add = (el: Element) => {
      if (watched.has(el)) return;
      watched.add(el);
      io.observe(el);
    };
    const visit = (node: Node, fn: (el: Element) => void) => {
      if (!(node instanceof Element)) return;
      if (node.matches(WATCH)) fn(node);
      node.querySelectorAll(WATCH).forEach(fn);
    };
    root.querySelectorAll(WATCH).forEach(add);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => visit(n, add));
        r.removedNodes.forEach((n) =>
          visit(n, (el) => {
            if (!watched.delete(el)) return;
            io.unobserve(el);
          }),
        );
      }
    });
    mo.observe(root, { childList: true, subtree: true });

    // Cursor spotlight (mouse / trackpad only).
    const fine = window.matchMedia("(pointer: fine)").matches;
    let current: HTMLElement | null = null;
    let raf = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      raf = 0;
      if (!last) return;
      const target = last.target instanceof Element ? (last.target.closest(SPOT) as HTMLElement | null) : null;
      if (target !== current) {
        current?.removeAttribute("data-spot-on");
        current = target;
        current?.setAttribute("data-spot-on", "");
      }
      if (!current) return;
      const r = current.getBoundingClientRect();
      current.style.setProperty("--mx", `${Math.round(last.clientX - r.left)}px`);
      current.style.setProperty("--my", `${Math.round(last.clientY - r.top)}px`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      last = e;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      current?.removeAttribute("data-spot-on");
      current = null;
    };
    if (fine) {
      document.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }

    return () => {
      io.disconnect();
      mo.disconnect();
      watched.clear();
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return null;
}
