/**
 * Structural config for the public website (navigation, form subjects, map
 * links). All copy and images live in ./content.ts.
 */

export const NAV_LINKS = [
  { href: "/rooms", label: "Rooms" },
  { href: "/restaurant", label: "Dining" },
  { href: "/menu", label: "Menu" },
  { href: "/meeting-room", label: "Meeting Room" },
  { href: "/transport", label: "Transport" },
  { href: "/gallery", label: "Gallery" },
  { href: "/hotel", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

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
