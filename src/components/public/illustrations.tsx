/** Fine gold line illustrations for venues that have no photography yet. */

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function DiningIllustration({ className = "h-64 w-64" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} {...common}>
      <circle cx="100" cy="100" r="92" opacity="0.35" />
      <circle cx="100" cy="100" r="54" />
      <circle cx="100" cy="100" r="40" opacity="0.5" />
      <path d="M36 52v34c0 6 4 10 9 10v58M45 52v30M54 52v34c0 6-4 10-9 10" />
      <path d="M160 52c-10 6-12 26-12 40 0 5 4 8 8 8h4v54" />
    </svg>
  );
}

export function BarIllustration({ className = "h-64 w-64" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} {...common}>
      <circle cx="100" cy="100" r="92" opacity="0.35" />
      <path d="M58 58h60l-30 38z" />
      <path d="M88 96v48M72 146h32" />
      <path d="M70 70h36" opacity="0.5" />
      <circle cx="112" cy="52" r="10" opacity="0.8" />
      <path d="M126 88h24v44a12 12 0 0 1-24 0z" />
      <path d="M126 104h24" opacity="0.5" />
      <path d="M138 144v12" />
    </svg>
  );
}

export function MeetingIllustration({ className = "h-64 w-64" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} {...common}>
      <circle cx="100" cy="100" r="92" opacity="0.35" />
      <rect x="54" y="84" width="92" height="36" rx="18" />
      <circle cx="74" cy="70" r="7" /><circle cx="100" cy="70" r="7" /><circle cx="126" cy="70" r="7" />
      <circle cx="74" cy="134" r="7" /><circle cx="100" cy="134" r="7" /><circle cx="126" cy="134" r="7" />
      <circle cx="40" cy="102" r="7" /><circle cx="160" cy="102" r="7" />
      <path d="M86 102h28" opacity="0.5" />
    </svg>
  );
}
