/**
 * Structural config for the public website (navigation, form subjects, map
 * links). All copy and images live in ./content.ts.
 * Labels are English keys (msg) — shown with t(label) where they are rendered.
 */
import { msg } from "@/i18n/msg";

export type NavLinkItem = { href: string; label: string };
export type NavItem = NavLinkItem & {
  /** Path prefixes that mark this item as the current page ([] = never; default = href without #hash). */
  match?: readonly string[];
  /** Related pages shown as small links beside the item in the phone menu. */
  sub?: readonly NavLinkItem[];
};

/**
 * Desktop header: Rooms · Dining · Experiences · Services · About · Contact (+ Book your stay).
 * Experiences and Services are sections of the About page (/hotel#experiences, /hotel#services).
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "/rooms", label: msg("Rooms") },
  { href: "/restaurant", label: msg("Dining"), match: ["/restaurant", "/menu", "/bar"] },
  { href: "/hotel#experiences", label: msg("Experiences"), match: [] },
  { href: "/hotel#services", label: msg("Services"), match: [] },
  { href: "/hotel", label: msg("About"), match: ["/hotel", "/gallery"] },
  { href: "/contact", label: msg("Contact") },
];

/** Phone menu: the same story plus Meeting Room and Transport; related pages grouped beside their parent. */
export const MENU_NAV: readonly NavItem[] = [
  { href: "/rooms", label: msg("Rooms") },
  { href: "/restaurant", label: msg("Dining"), sub: [{ href: "/menu", label: msg("Menu") }, { href: "/bar", label: msg("Bar") }] },
  { href: "/hotel#experiences", label: msg("Experiences"), match: [] },
  { href: "/hotel#services", label: msg("Services"), match: [] },
  { href: "/meeting-room", label: msg("Meeting Room") },
  { href: "/transport", label: msg("Transport") },
  { href: "/hotel", label: msg("About"), sub: [{ href: "/gallery", label: msg("Gallery") }] },
  { href: "/contact", label: msg("Contact") },
];

/** Footer navigation, grouped. */
export const FOOTER_NAV: readonly { title: string; links: readonly NavLinkItem[] }[] = [
  {
    title: msg("Stay"),
    links: [
      { href: "/rooms", label: msg("Rooms & suites") },
      { href: "/book", label: msg("Book your stay") },
      { href: "/meeting-room", label: msg("Meeting Room") },
      { href: "/transport", label: msg("Airport transfer") },
    ],
  },
  {
    title: msg("Dine"),
    links: [
      { href: "/restaurant", label: msg("Restaurant") },
      { href: "/menu", label: msg("Menu") },
      { href: "/bar", label: msg("Bar") },
    ],
  },
  {
    title: msg("Hotel"),
    links: [
      { href: "/hotel", label: msg("About") },
      { href: "/hotel#services", label: msg("Services") },
      { href: "/gallery", label: msg("Gallery") },
      { href: "/contact", label: msg("Contact") },
      { href: "/contact?subject=existing", label: msg("Help with a booking") },
    ],
  },
];

/** True when `pathname` is the page (or a sub-page) of a nav item. */
export function isNavActive(item: NavItem, pathname: string | null): boolean {
  if (!pathname) return false;
  const prefixes = item.match ?? [item.href.split("#")[0]];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The header's links ({ href, label }) — kept for older imports. */
export const NAV_LINKS: readonly NavLinkItem[] = PRIMARY_NAV.map(({ href, label }) => ({ href, label }));

export const CONTACT_SUBJECTS = [
  { key: "booking", label: msg("Room booking") },
  { key: "existing", label: msg("My existing booking") },
  { key: "meeting", label: msg("Meeting room enquiry") },
  { key: "dining", label: msg("Restaurant & bar") },
  { key: "transfer", label: msg("Airport transfer") },
  { key: "general", label: msg("General question") },
] as const;

export const MAP_EMBED_URL = "https://www.google.com/maps?q=Mlimani+City+Mwenge+Dar+es+Salaam&output=embed";
export const MAP_LINK_URL = "https://www.google.com/maps/search/?api=1&query=Mlimani+City+Mwenge+Dar+es+Salaam";

export { GALLERY, GALLERY_CATEGORIES, photo, type GalleryCategory, type GalleryImage } from "./content";
