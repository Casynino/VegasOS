"use client";

import { useEffect, useRef } from "react";

interface Star { x: number; y: number; r: number; depth: number; phase: number; speed: number; gold: boolean }
interface Ember { x: number; y: number; r: number; vy: number; vx: number; life: number; max: number }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number }

/**
 * Night sky over Dar es Salaam — the living backdrop behind every dark section
 * of the public site: layered twinkling stars (white and gold) that drift with
 * scroll parallax, slow nebula glows (warm gold, Indian-Ocean blue), rising
 * gold embers, and an occasional shooting star. One fixed canvas, DPR-aware,
 * paused when the tab is hidden; a single still frame for reduced motion.
 */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, running = true;
    let stars: Star[] = [];
    let embers: Ember[] = [];
    let meteor: Meteor | null = null;
    let nextMeteor = performance.now() + 4000;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas!.width = Math.round(w * dpr); canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`; canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(700, (w * h) / 2400));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h * 1.6, r: Math.random() < 0.1 ? rand(1.2, 2.1) : rand(0.4, 1.2),
        depth: rand(0.05, 0.4), phase: Math.random() * Math.PI * 2, speed: rand(0.6, 1.8), gold: Math.random() < 0.28,
      }));
      embers = Array.from({ length: Math.round(count / 14) }, () => newEmber(true));
    }
    function newEmber(anywhere = false): Ember {
      const max = rand(9000, 18000);
      return { x: Math.random() * w, y: anywhere ? Math.random() * h : h + 10, r: rand(0.8, 2.2), vy: rand(0.008, 0.022), vx: rand(-0.004, 0.004), life: anywhere ? Math.random() * max : 0, max };
    }

    function nebula(t: number) {
      const pulse = 0.85 + Math.sin(t / 5200) * 0.15;
      const g1 = ctx!.createRadialGradient(w * 0.82, h * 0.18, 0, w * 0.82, h * 0.18, Math.max(w, h) * 0.55);
      g1.addColorStop(0, `rgba(212,166,74,${0.24 * pulse})`); g1.addColorStop(0.45, "rgba(150,95,40,0.09)"); g1.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = g1; ctx!.fillRect(0, 0, w, h);
      const g2 = ctx!.createRadialGradient(w * 0.12, h * 0.85, 0, w * 0.12, h * 0.85, Math.max(w, h) * 0.6);
      g2.addColorStop(0, `rgba(50,95,190,${0.26 * (1.1 - pulse * 0.2)})`); g2.addColorStop(0.5, "rgba(35,60,130,0.09)"); g2.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = g2; ctx!.fillRect(0, 0, w, h);
      // faint milky band
      ctx!.save(); ctx!.translate(w / 2, h / 2); ctx!.rotate(-0.42);
      const band = ctx!.createLinearGradient(0, -h * 0.18, 0, h * 0.18);
      band.addColorStop(0, "rgba(255,255,255,0)"); band.addColorStop(0.5, "rgba(235,220,195,0.07)"); band.addColorStop(1, "rgba(255,255,255,0)");
      ctx!.fillStyle = band; ctx!.fillRect(-w, -h * 0.18, w * 2, h * 0.36); ctx!.restore();
    }

    let last = performance.now();
    function frame(t: number) {
      const dt = Math.min(64, t - last); last = t;
      const sy = window.scrollY;
      ctx!.clearRect(0, 0, w, h);
      nebula(t);

      for (const s of stars) {
        const y = ((s.y - sy * s.depth) % (h * 1.6) + h * 1.6) % (h * 1.6);
        if (y > h + 2) continue;
        const tw = reduce ? 0.9 : 0.6 + 0.4 * Math.sin(t / 1000 * s.speed + s.phase);
        ctx!.globalAlpha = tw;
        ctx!.fillStyle = s.gold ? "#f0cf86" : "#f4efe6";
        ctx!.beginPath(); ctx!.arc(s.x, y, s.r, 0, Math.PI * 2); ctx!.fill();
        if (s.r > 1.1) { // bright stars get a soft cross flare
          ctx!.globalAlpha = tw * 0.35;
          ctx!.fillRect(s.x - s.r * 4, y - 0.3, s.r * 8, 0.6);
          ctx!.fillRect(s.x - 0.3, y - s.r * 4, 0.6, s.r * 8);
        }
      }

      if (!reduce) {
        for (let i = 0; i < embers.length; i++) {
          const e = embers[i];
          e.life += dt; e.y -= e.vy * dt; e.x += e.vx * dt;
          if (e.life > e.max || e.y < -10) { embers[i] = newEmber(); continue; }
          const a = Math.sin((e.life / e.max) * Math.PI) * 0.55;
          const g = ctx!.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 4);
          g.addColorStop(0, `rgba(240,200,120,${a})`); g.addColorStop(1, "rgba(240,200,120,0)");
          ctx!.globalAlpha = 1; ctx!.fillStyle = g;
          ctx!.beginPath(); ctx!.arc(e.x, e.y, e.r * 4, 0, Math.PI * 2); ctx!.fill();
        }
        if (!meteor && t > nextMeteor) {
          meteor = { x: rand(w * 0.2, w * 0.9), y: rand(-20, h * 0.3), vx: -rand(0.7, 1.1), vy: rand(0.35, 0.55), life: 0 };
          nextMeteor = t + rand(7000, 14000);
        }
        if (meteor) {
          meteor.life += dt; meteor.x += meteor.vx * dt; meteor.y += meteor.vy * dt;
          const len = 140, a = Math.max(0, 1 - meteor.life / 1400);
          const g = ctx!.createLinearGradient(meteor.x, meteor.y, meteor.x - meteor.vx * len, meteor.y - meteor.vy * len);
          g.addColorStop(0, `rgba(255,240,210,${a})`); g.addColorStop(1, "rgba(255,240,210,0)");
          ctx!.globalAlpha = 1; ctx!.strokeStyle = g; ctx!.lineWidth = 1.4;
          ctx!.beginPath(); ctx!.moveTo(meteor.x, meteor.y); ctx!.lineTo(meteor.x - meteor.vx * len, meteor.y - meteor.vy * len); ctx!.stroke();
          if (a <= 0) meteor = null;
        }
      }
      ctx!.globalAlpha = 1;
      if (running && !reduce) raf = requestAnimationFrame(frame);
    }

    resize();
    frame(performance.now());
    const onResize = () => { resize(); if (reduce) frame(performance.now()); };
    const onScroll = () => { if (reduce) frame(performance.now()); };
    const onVis = () => {
      running = !document.hidden;
      cancelAnimationFrame(raf);
      if (running && !reduce) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 h-svh w-screen" />;
}
