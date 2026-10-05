/**
 * Structural config for the public website (navigation, form subjects, map
 * links). All copy and images live in ./content.ts.
 */

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
  { href: "/rooms", label: "Rooms" },
  { href: "/restaurant", label: "Dining", match: ["/restaurant", "/menu", "/bar"] },
  { href: "/hotel#experiences", label: "Experiences", match: [] },
  { href: "/hotel#services", label: "Services", match: [] },
  { href: "/hotel", label: "About", match: ["/hotel", "/gallery"] },
  { href: "/contact", label: "Contact" },
];

/** Phone menu: the same story plus Meeting Room and Transport; related pages grouped beside their parent. */
export const MENU_NAV: readonly NavItem[] = [
  { href: "/rooms", label: "Rooms" },
  { href: "/restaurant", label: "Dining", sub: [{ href: "/menu", label: "Menu" }, { href: "/bar", label: "Bar" }] },
  { href: "/hotel#experiences", label: "Experiences", match: [] },
  { href: "/hotel#services", label: "Services", match: [] },
  { href: "/meeting-room", label: "Meeting Room" },
  { href: "/transport", label: "Transport" },
  { href: "/hotel", label: "About", sub: [{ href: "/gallery", label: "Gallery" }] },
  { href: "/contact", label: "Contact" },
];

/** Footer navigation, grouped. */
export const FOOTER_NAV: readonly { title: string; links: readonly NavLinkItem[] }[] = [
  {
    title: "Stay",
    links: [
      { href: "/rooms", label: "Rooms & suites" },
      { href: "/book", label: "Book your stay" },
      { href: "/meeting-room", label: "Meeting Room" },
      { href: "/transport", label: "Airport transfer" },
    ],
  },
  {
    title: "Dine",
    links: [
      { href: "/restaurant", label: "Restaurant" },
      { href: "/menu", label: "Menu" },
      { href: "/bar", label: "Bar" },
    ],
  },
  {
    title: "Hotel",
    links: [
      { href: "/hotel", label: "About" },
      { href: "/hotel#services", label: "Services" },
      { href: "/gallery", label: "Gallery" },
      { href: "/contact", label: "Contact" },
      { href: "/contact?subject=existing", label: "Help with a booking" },
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
  { key: "booking", label: "Room booking" },
  { key: "existing", label: "My existing booking" },
  { key: "meeting", label: "Meeting room enquiry" },
  { key: "dining", label: "Restaurant & bar" },
  { key: "transfer", label: "Airport transfer" },
  { key: "general", label: "General question" },
] as const;

export const MAP_EMBED_URL = "https://www.google.com/maps?q=Mlimani+City+Mwenge+Dar+es+Salaam&output=embed";
export const MAP_LINK_URL = "https://www.google.com/maps/search/?api=1&query=Mlimani+City+Mwenge+Dar+es+Salaam";

export { GALLERY, GALLERY_CATEGORIES, photo, type GalleryCategory, type GalleryImage } from "./content";
