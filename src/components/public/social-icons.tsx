/**
 * The social networks' own marks (lucide has no brand icons). currentColor, sized by className — they sit with the
 * gold line icons of the footer and the contact page.
 */
type IconProps = { className?: string; strokeWidth?: number; "aria-hidden"?: boolean | "true" | "false" };

export function InstagramIcon({ className, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="5.2" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="17.35" cy="6.65" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TikTokIcon({ className, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" {...rest}>
      <path d="M16.6 3c.32 2.09 1.62 3.6 3.9 3.86v2.86a7.6 7.6 0 0 1-3.86-1.1v6.4c0 3.37-2.5 5.98-5.85 5.98A5.86 5.86 0 0 1 5 15.15c0-3.6 3.13-6.24 6.7-5.73v3.02a2.86 2.86 0 0 0-3.68 2.71 2.83 2.83 0 0 0 2.9 2.83c1.62 0 2.83-1.2 2.83-3.06V3h2.85Z" />
    </svg>
  );
}

export function FacebookIcon({ className, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" {...rest}>
      <path d="M13.5 21v-7.6h2.56l.38-2.97H13.5V8.53c0-.86.24-1.45 1.47-1.45h1.57V4.43A21 21 0 0 0 14.25 4.3c-2.27 0-3.82 1.39-3.82 3.93v2.2H7.86v2.97h2.57V21h3.07Z" />
    </svg>
  );
}

/** "https://www.instagram.com/vegas_hotel/" → "@vegas_hotel"; TikTok and Facebook the same way. */
export function socialHandle(url: string) {
  const path = url.replace(/^https?:\/\/(www\.)?[^/]+\//, "").replace(/[/?#].*$/, "");
  return path ? (path.startsWith("@") ? path : `@${path}`) : url;
}
