/**
 * PUBLIC SITE CONTENT — the single source of every piece of public copy and
 * every image path/alt on the website. Pages read only from `getSiteContent()`.
 *
 * These are the verified defaults. Managers override individual fields in
 * Staff → Website; `getSiteContent()` (server) merges the overrides.
 *
 * Text may contain placeholders filled from hotel settings at render time:
 *   {hotelName} {address} {city} {checkIn} {checkOut} {airportKm}
 * Only confirmed facts belong here — no ratings, awards or invented services.
 */

export interface Img {
  src: string;
  alt: string;
  title?: string;
  category?: string;
}

export interface Service {
  key: string;
  name: string;
  icon: string; // lucide icon name (see icon.tsx)
  description: string;
}

export interface Cta {
  label: string;
  href: string;
}

// ───────────────────────────── Hotel photo library ─────────────────────────────

export type GalleryCategory = "exterior" | "lobby" | "rooms" | "bath" | "amenity";

export const GALLERY_CATEGORIES: { key: GalleryCategory; label: string }[] = [
  { key: "rooms", label: "Rooms" },
  { key: "bath", label: "Bathrooms" },
  { key: "lobby", label: "Reception" },
  { key: "exterior", label: "Exterior" },
  { key: "amenity", label: "Details" },
];

export interface GalleryImage {
  src: string;
  width: number;
  height: number;
  alt: string;
  category: GalleryCategory;
}

const RAW: [string, number, number][] = [
  ["/images/amenity/amenity-01.webp", 1279, 1920],
  ["/images/amenity/amenity-02.webp", 2000, 1333],
  ["/images/amenity/amenity-03.webp", 2000, 1333],
  ["/images/amenity/amenity-04.webp", 2000, 1333],
  ["/images/bath/bath-01.webp", 1920, 1280],
  ["/images/bath/bath-02.webp", 1279, 1920],
  ["/images/bath/bath-03.webp", 1920, 1280],
  ["/images/bath/bath-04.webp", 1920, 1280],
  ["/images/bath/bath-05.webp", 1920, 1280],
  ["/images/bath/bath-06.webp", 1920, 1280],
  ["/images/bath/bath-07.webp", 2048, 1366],
  ["/images/bath/bath-08.webp", 2048, 1366],
  ["/images/bath/bath-09.webp", 1152, 1536],
  ["/images/bath/bath-10.webp", 2048, 1536],
  ["/images/bath/bath-11.webp", 2048, 1536],
  ["/images/bath/bath-12.webp", 2048, 1536],
  ["/images/bath/bath-13.webp", 2048, 1536],
  ["/images/bath/bath-14.webp", 2048, 1536],
  ["/images/bath/bath-15.webp", 2048, 1536],
  ["/images/bath/bath-16.webp", 2048, 1536],
  ["/images/bath/bath-17.webp", 2000, 1333],
  ["/images/bath/bath-18.webp", 2000, 1333],
  ["/images/bath/bath-19.webp", 2000, 1333],
  ["/images/exterior/exterior-01.webp", 2048, 1366],
  ["/images/exterior/exterior-02.webp", 2048, 1365],
  ["/images/exterior/exterior-03.webp", 960, 1280],
  ["/images/exterior/exterior-04.webp", 853, 1280],
  ["/images/lobby/lobby-01.webp", 2048, 1366],
  ["/images/lobby/lobby-02.webp", 2048, 1366],
  ["/images/lobby/lobby-03.webp", 2048, 1366],
  ["/images/meeting/meeting-01.webp", 1280, 853],
  ["/images/room-blue/room-blue-01.webp", 2048, 1366],
  ["/images/room-blue/room-blue-02.webp", 2048, 1366],
  ["/images/room-blue/room-blue-03.webp", 2048, 1536],
  ["/images/room-blue/room-blue-04.webp", 2048, 1536],
  ["/images/room-blue/room-blue-05.webp", 1152, 1536],
  ["/images/room-blue/room-blue-06.webp", 2048, 1536],
  ["/images/room-blue/room-blue-07.webp", 2048, 1536],
  ["/images/room-blue/room-blue-08.webp", 2048, 1536],
  ["/images/room-blue/room-blue-09.webp", 1152, 1536],
  ["/images/room-blue/room-blue-10.webp", 1152, 1536],
  ["/images/room-blue/room-blue-11.webp", 2048, 1536],
  ["/images/room-blue/room-blue-12.webp", 2048, 1536],
  ["/images/room-blue/room-blue-13.webp", 2048, 1536],
  ["/images/room-blue/room-blue-14.webp", 2048, 1536],
  ["/images/room-blue/room-blue-15.webp", 2048, 1536],
  ["/images/room-blue/room-blue-16.webp", 2048, 1536],
  ["/images/room-blue/room-blue-17.webp", 2048, 1536],
  ["/images/room-blue/room-blue-18.webp", 2048, 1536],
  ["/images/room-blue/room-blue-19.webp", 1152, 1536],
  ["/images/room-blue/room-blue-20.webp", 2048, 1536],
  ["/images/room-red/room-red-01.webp", 1080, 1920],
  ["/images/room-red/room-red-02.webp", 1080, 1920],
  ["/images/room-red/room-red-03.webp", 1080, 1920],
  ["/images/room-red/room-red-04.webp", 1920, 1280],
  ["/images/room-red/room-red-05.webp", 2048, 1366],
  ["/images/room-red/room-red-06.webp", 1920, 1280],
  ["/images/room-red/room-red-07.webp", 2048, 1366],
  ["/images/room-red/room-red-08.webp", 1125, 2000],
  ["/images/room-red/room-red-09.webp", 2000, 1333],
  ["/images/room-red/room-red-10.webp", 1333, 2000],
];

const JACUZZI = new Set(["bath-01", "bath-02", "bath-07", "bath-08", "bath-10", "bath-11", "bath-12", "bath-13", "bath-15"]);
const SPECIFIC: Record<string, string> = {
  "exterior-01": "Exterior of the Vegas Luxury Hotel building",
  "exterior-02": "Street entrance of Vegas Luxury Hotel with its gold arch gate",
  "lobby-01": "Reception desk with the Vegas Luxury Hotel crest",
  "lobby-02": "Reception and lobby at Vegas Luxury Hotel",
  "lobby-03": "Reception desk and world clocks in the lobby",
  "amenity-01": "Bathrobe provided for guests in the room",
  "room-blue-01": "Seating area and en-suite door in a guest room",
  "room-blue-02": "Work desk, TV and air conditioning in a guest room",
  "room-red-06": "Tea and coffee tray by the window in a suite",
  "room-red-07": "Lounge sofa in an Executive Suite",
  // The owner's newer photographs (no room type is implied).
  "exterior-03": "The yellow façade and entrance gate of Vegas Luxury Hotel",
  "exterior-04": "Balconies of Vegas Luxury Hotel against a blue sky",
  "room-red-08": "Guest room with a king bed, red runner, sofa and a floor-to-ceiling window",
  "room-red-09": "Bed dressed with Vegas Luxury Hotel cushions and a red runner",
  "room-red-10": "The bed reflected in the room's oval mirror",
  "amenity-02": "Sofa, oval mirror and a hotel bathrobe",
  "amenity-03": "Desk, kettle, mini fridge and room phone",
  "amenity-04": "Lounge sofa beside a tall oval mirror",
  "bath-17": "Washbasin with a round black mirror",
  "bath-18": "Wave-tiled bathroom with fresh towels",
  "bath-19": "Bathroom with a bathtub and shower",
  "meeting-01": "Vegas Luxury Hotel meeting room with a U-shaped boardroom table",
};

function describe(src: string): { category: GalleryCategory; alt: string } {
  const key = src.split("/").pop()!.replace(".webp", "");
  const category: GalleryCategory = src.includes("/exterior/") ? "exterior"
    : src.includes("/lobby/") ? "lobby"
    : src.includes("/bath/") ? "bath"
    : src.includes("/amenity/") || src.includes("/meeting/") ? "amenity"
    : "rooms";
  if (SPECIFIC[key]) return { category, alt: SPECIFIC[key] };
  if (category === "bath") {
    return { category, alt: JACUZZI.has(key) ? "En-suite bathroom with a jetted jacuzzi bathtub" : "Private en-suite bathroom with walk-in shower" };
  }
  if (src.includes("/room-red/")) return { category, alt: "Suite bedroom with red Vegas Luxury Hotel cushions and throw" };
  return { category, alt: "Guest bedroom with blue Vegas Luxury Hotel cushions and throw" };
}

export const GALLERY: GalleryImage[] = RAW.map(([src, width, height]) => ({ src, width, height, ...describe(src) }));

const BY_SRC = new Map(GALLERY.map((g) => [g.src, g]));

/** Known dimensions + alt for a photo in /public/images (falls back to 4:3). */
export function photo(src: string): GalleryImage {
  return BY_SRC.get(src) ?? { src, width: 1024, height: 768, alt: "Vegas Luxury Hotel", category: "rooms" };
}

/**
 * Portrait companions for landscape hero photos: on phones a page hero shows the portrait
 * photograph instead of a narrow crop of the landscape one (art direction, one download per device).
 * Keyed by the landscape photo, so a manager's own hero photo simply has no companion.
 */
const PORTRAIT: Record<string, string> = {
  "/images/room-red/room-red-05.webp": "/images/room-red/room-red-08.webp",
  "/images/exterior/exterior-01.webp": "/images/exterior/exterior-03.webp",
};
export function portraitFor(src: string): string | undefined {
  return PORTRAIT[src];
}

/**
 * Details from across the hotel's rooms (the owner's own photographs) for the "in the room"
 * rails on the rooms pages. They belong to no single room type, and the rails say so.
 */
export const ROOM_DETAILS = [
  "/images/room-red/room-red-10.webp",
  "/images/amenity/amenity-02.webp",
  "/images/amenity/amenity-03.webp",
  "/images/room-red/room-red-09.webp",
  "/images/bath/bath-18.webp",
  "/images/amenity/amenity-04.webp",
  "/images/bath/bath-17.webp",
  "/images/room-red/room-red-08.webp",
  "/images/bath/bath-19.webp",
];

// ───────────────────────────── Illustrative photography ─────────────────────────────
/**
 * Licensed stock photography (Unsplash License — free for commercial use) used
 * ONLY for atmosphere where the hotel has no photo yet (restaurant, bar,
 * meeting room, city views). Always shown with an "Illustrative" tag and never
 * described as the hotel. Replace with the hotel's own photos when available.
 */
/** Meeting room gallery, in order (the room type's own photos replace these once the hotel adds them). */
export const MEETING_GALLERY_KEYS = ["meetingBoardroom", "meetingLongTable", "meetingCityView", "meetingRoom", "meetingScreen", "meetingChairs"] as const;
export interface IllustrativeImg { src: string; alt: string; width: number; height: number; source: string }
export const ILLUSTRATIVE = {
  restaurantWarm: { src: "/images/illustrative/restaurant-warm.webp", width: 2000, height: 1275, alt: "Warmly lit restaurant with set tables (illustrative)", source: "https://unsplash.com/photos/e4B5AvA7Jqo" },
  restaurantLounge: { src: "/images/illustrative/restaurant-lounge.webp", width: 1300, height: 1950, alt: "Evening dining room with soft lighting (illustrative)", source: "https://unsplash.com/photos/PisnUZWdsms" },
  dinnerCityNight: { src: "/images/illustrative/dinner-city-night.webp", width: 1300, height: 1950, alt: "Table for two above city lights at night (illustrative)", source: "https://unsplash.com/photos/msW_vhahYRc" },
  barCounter: { src: "/images/illustrative/bar-counter.webp", width: 1300, height: 1950, alt: "Bar counter with stools and shelves of bottles (illustrative)", source: "https://unsplash.com/photos/DbMZgyFrycw" },
  barPour: { src: "/images/illustrative/bar-pour.webp", width: 2000, height: 1331, alt: "Bartender pouring a drink (illustrative)", source: "https://unsplash.com/photos/VIVfpC6bV9o" },
  barMartini: { src: "/images/illustrative/bar-martini.webp", width: 1300, height: 1950, alt: "A martini on the bar (illustrative)", source: "https://unsplash.com/photos/QjUY7auDzUQ" },
  meetingRoom: { src: "/images/illustrative/meeting-room.webp", width: 2000, height: 1334, alt: "Modern meeting room with a long table (illustrative)", source: "https://unsplash.com/photos/s-KphF10sWM" },
  meetingBoardroom: { src: "/images/illustrative/meeting-boardroom.webp", width: 2000, height: 1333, alt: "Boardroom table with leather chairs by tall windows (illustrative)", source: "https://unsplash.com/photos/GWe0dlVD9e0" },
  meetingLongTable: { src: "/images/illustrative/meeting-long-table.webp", width: 2000, height: 1333, alt: "Long meeting table with a screen at the end (illustrative)", source: "https://unsplash.com/photos/0sT9YhNgSEs" },
  meetingCityView: { src: "/images/illustrative/meeting-city-view.webp", width: 2000, height: 1600, alt: "Wooden meeting table with a city view (illustrative)", source: "https://unsplash.com/photos/_-KLkj7on_c" },
  meetingScreen: { src: "/images/illustrative/meeting-screen.webp", width: 2000, height: 1333, alt: "Small meeting room with a wall screen (illustrative)", source: "https://unsplash.com/photos/L__MBAI3ucc" },
  meetingChairs: { src: "/images/illustrative/meeting-chairs.webp", width: 2000, height: 1125, alt: "Office chairs lined up at a conference table (illustrative)", source: "https://unsplash.com/photos/RNsKphkdBTk" },
  darCityAerial: { src: "/images/illustrative/dar-city-aerial.webp", width: 2000, height: 1329, alt: "Aerial view of Dar es Salaam (illustrative)", source: "https://unsplash.com/photos/lZLgqIiFHSw" },
  darCoastAerial: { src: "/images/illustrative/dar-coast-aerial.webp", width: 2000, height: 1500, alt: "Aerial view of the Dar es Salaam coastline (illustrative)", source: "https://unsplash.com/photos/YBx99uI3t-I" },
  darSkyline: { src: "/images/illustrative/dar-skyline.webp", width: 2000, height: 1334, alt: "Dar es Salaam skyline by the harbour (illustrative)", source: "https://unsplash.com/photos/AbUnkdIElTc" },
} satisfies Record<string, IllustrativeImg>;

// ───────────────────────────── Services (confirmed only) ─────────────────────────────

const SERVICES: Service[] = [
  { key: "wifi", name: "Free Wi-Fi", icon: "Wifi", description: "Free Wi-Fi in every room." },
  { key: "breakfast", name: "Breakfast included", icon: "Coffee", description: "Breakfast is included with every room, every morning of your stay." },
  { key: "restaurant", name: "Restaurant", icon: "UtensilsCrossed", description: "From breakfast to dinner, right here in the hotel." },
  { key: "bar", name: "Bar", icon: "Wine", description: "A relaxed place to unwind at the end of the day." },
  { key: "room-service", name: "Room service", icon: "BellRing", description: "Food and drinks brought to your room." },
  { key: "reception", name: "24-hour reception", icon: "ConciergeBell", description: "Arriving late or leaving early, someone is always at the front desk." },
  { key: "housekeeping", name: "Housekeeping", icon: "BrushCleaning", description: "Your room kept fresh and tidy throughout your stay." },
  { key: "parking", name: "Free on-site parking", icon: "CircleParking", description: "Private parking on site, free for hotel guests." },
  { key: "transfer", name: "Airport transfer", icon: "Plane", description: "Pickup by the hotel’s own drivers — about {airportKm} km from JNIA." },
  { key: "meeting", name: "Meeting room", icon: "Presentation", description: "A private room for meetings and workshops." },
];

// ───────────────────────────── Default content ─────────────────────────────

export const DEFAULT_CONTENT = {
  /** Photos of the hotel only (never illustrative images). */
  gallery: GALLERY as Img[] & GalleryImage[],

  facts: {
    airportKm: 14,
    airportName: "Julius Nyerere International Airport (DAR)",
    airportShort: "JNIA",
    locationLine: "Mlimani City · Dar es Salaam",
  },

  services: SERVICES,

  seo: {
    ogImage: { src: "/images/room-red/room-red-04.webp", alt: "Guest room at Vegas Luxury Hotel", width: 1920, height: 1280 },
    homeTitle: "Vegas Luxury Hotel — Mlimani City, Dar es Salaam | Book direct",
    homeDescription:
      "Hotel at Mlimani City Roundabout, behind Mwenge Tower, Dar es Salaam. Rooms with free Wi-Fi and breakfast, restaurant, bar, meeting room and airport transfers. Book direct online and pay at the hotel.",
  },

  home: {
    hero: {
      image: { src: "/images/room-red/room-red-04.webp", alt: "Guest room at Vegas Luxury Hotel with red and gold hotel linens" },
      title: "Your stay,",
      titleAccent: "elevated.",
      intro: "Refined rooms, breakfast every morning and a warm welcome at Mlimani City — minutes from Mwenge.",
      primaryCta: { label: "Check availability", href: "/book" },
      secondaryCta: { label: "Explore rooms", href: "/rooms" },
      /** Cinematic hero sequence — real hotel photography only. */
      slides: [
        { src: "/images/room-red/room-red-04.webp", mobileSrc: "/images/room-red/room-red-08.webp", alt: "Guest room with red and gold Vegas Luxury Hotel linens and tall windows", caption: "Rooms & suites" },
        { src: "/images/room-red/room-red-09.webp", mobileSrc: "/images/room-red/room-red-10.webp", alt: "Bed dressed with Vegas Luxury Hotel cushions and a red runner", caption: "Hotel linens" },
        { src: "/images/exterior/exterior-01.webp", mobileSrc: "/images/exterior/exterior-03.webp", alt: "The Vegas Luxury Hotel building at Mlimani City", caption: "The hotel" },
        { src: "/images/amenity/amenity-02.webp", alt: "Sofa, oval mirror and a hotel bathrobe in a guest room", caption: "In the room" },
        { src: "/images/bath/bath-01.webp", mobileSrc: "/images/amenity/amenity-01.webp", alt: "Jacuzzi bathtub fittings in a suite bathroom", caption: "Suite bathroom" },
      ],
      highlights: ["Complimentary breakfast", "Free Wi-Fi", "Restaurant & bar", "Meeting room"],
      chips: [
        { icon: "Coffee", text: "Breakfast included, every stay" },
        { icon: "Wifi", text: "Free Wi-Fi in every room" },
        { icon: "Plane", text: "Airport pickup by our drivers" },
      ],
    },
    intro: {
      kicker: "Welcome to Vegas",
      title: "A place to slow down, stay comfortably",
      titleAccent: "and see Dar es Salaam differently.",
      paragraphs: [
        "Every room has air conditioning, a private bathroom, a flat-screen TV, a work desk and a tea and coffee maker — quiet, clean and ready when you walk in.",
        "Our suites add more space to spread out, and many of our bathrooms have jacuzzi bathtubs for the end of a long day.",
      ],
      mainImage: { src: "/images/room-red/room-red-01.webp", alt: "Executive Suite bedroom with red and gold Vegas linens" },
      insetImage: { src: "/images/exterior/exterior-03.webp", alt: "The yellow façade and entrance gate of Vegas Luxury Hotel" },
    },
    stay: {
      kicker: "The Vegas experience",
      title: "Everything a good stay needs,",
      titleAccent: "under one roof.",
      items: [
        { key: "stay", title: "Stay", body: "Quiet, air-conditioned rooms with private bathrooms — many with jacuzzi bathtubs.", image: "/images/room-red/room-red-05.webp", href: "/rooms" },
        { key: "dine", title: "Dine", body: "Breakfast to dinner in our restaurant, and drinks at the bar when the day is done.", href: "/restaurant" },
        { key: "connect", title: "Connect", body: "Free Wi-Fi in every room, a work desk and a 24-hour reception.", href: "/hotel" },
        { key: "gather", title: "Gather", body: "A private meeting room for meetings, workshops and gatherings.", image: "/images/lobby/lobby-03.webp", href: "/meeting-room" },
      ],
    },
    rooms: {
      kicker: "Rooms & suites",
      title: "Rest, beautifully arranged",
      intro: "Every room type includes free Wi-Fi and breakfast.",
    },
    experience: {
      kicker: "Why guests choose Vegas",
      title: "Thoughtful things, already included",
      intro: "No surprises at check-out: these come with your room. Book online and pay by mobile money in seconds.",
      image: { src: "/images/bath/bath-07.webp", alt: "En-suite bathroom with a jetted jacuzzi bathtub" },
      features: [
        { icon: "Coffee", title: "Breakfast included", body: "Breakfast is included with every room, every morning of your stay." },
        { icon: "Wifi", title: "Free Wi-Fi", body: "Stay connected in every room — for work, streaming or calling home." },
        { icon: "ConciergeBell", title: "Room service", body: "Meals and drinks brought to your room when you would rather stay in." },
        { icon: "CircleParking", title: "Free on-site parking", body: "Private parking on site, free for hotel guests." },
        { icon: "Clock", title: "24-hour reception", body: "Arriving late or leaving early, someone is always at the front desk." },
        { icon: "Wallet", title: "Pay by mobile money", body: "No card needed — M-Pesa, Airtel Money, Mixx by Yas or HaloPesa, straight from your phone." },
      ],
    },
    services: {
      kicker: "Services",
      title: "Everything close at hand",
      intro: "Confirmed services for every guest of {hotelName}.",
    },
    restaurant: {
      kicker: "The restaurant",
      title: "From breakfast to",
      titleAccent: "cocktail hour",
      body: "Our restaurant is open from breakfast through to dinner, with a menu that travels from African favourites to pizza, sushi and the grill.",
      menuKicker: "On the menu",
      cta: { label: "Discover the restaurant", href: "/restaurant" },
    },
    bar: {
      kicker: "The bar",
      title: "Unwind with a drink",
      titleAccent: "at the end of the day",
      body: "A relaxed spot to meet a colleague, catch up with friends or simply slow down before dinner. Drop in during your stay.",
      cta: { label: "Visit the bar", href: "/bar" },
    },
    meeting: {
      kicker: "Meet & work",
      title: "The Meeting Room",
      body: "A private meeting room for meetings and workshops, with our restaurant right here in the hotel. Tell us your date and group, and we’ll take care of the rest.",
      events: ["Business meetings", "Workshops", "Private gatherings"],
      primaryCta: { label: "Check availability & book", href: "/meeting-room#book" },
      secondaryCta: { label: "Learn more", href: "/meeting-room" },
    },
    arrival: {
      kicker: "Arrival",
      title: "We’ll meet you at the airport",
      body: "{hotelName} is about {airportKm} km from Julius Nyerere International Airport. Our own drivers can collect you — just request a pickup when you book, with your flight details, and we’ll confirm by phone or WhatsApp.",
      steps: [
        { title: "Request when booking", body: "Tick “Airport pickup” and add your flight number and arrival time." },
        { title: "We confirm", body: "Our team confirms your pickup by phone or WhatsApp." },
        { title: "Meet your driver", body: "A hotel driver meets you on arrival and brings you straight here." },
      ],
      cta: { label: "Book with airport pickup", href: "/book" },
    },
    gallery: {
      kicker: "Gallery",
      title: "A look inside",
      images: [
        "/images/room-red/room-red-05.webp",
        "/images/bath/bath-07.webp",
        "/images/room-blue/room-blue-01.webp",
        "/images/lobby/lobby-02.webp",
        "/images/room-red/room-red-06.webp",
        "/images/room-red/room-red-07.webp",
        "/images/room-blue/room-blue-17.webp",
      ],
    },
    location: {
      kicker: "Location",
      title: "Behind Mwenge Tower, at Mlimani City Roundabout",
      image: { src: "/images/exterior/exterior-02.webp", alt: "Street entrance of Vegas Luxury Hotel with its gold arch gate" },
      points: [
        { icon: "Plane", title: "About {airportKm} km to the airport", body: "Julius Nyerere International Airport — hotel airport transfer available." },
        { icon: "MapPinned", title: "Mlimani City & Mwenge", body: "Right by the Mlimani City roundabout, behind Mwenge Tower." },
      ],
    },
    cta: {
      kicker: "Book direct",
      title: "Your room",
      titleAccent: "is waiting.",
      body: "Choose your dates and send your request — our team confirms it with you, and you pay when you arrive.",
      image: { src: "/images/room-red/room-red-04.webp", alt: "" },
    },
  },

  pages: {
    rooms: {
      kicker: "Rooms & suites",
      title: "Find the room that fits your stay",
      intro: "From a smart single for solo travellers to our spacious Executive Suites.",
      image: { src: "/images/room-red/room-red-05.webp", alt: "Suite bedroom at Vegas Luxury Hotel" },
      includedTitle: "Included, whichever you choose",
      includedNote: "Check-in from {checkIn}, check-out by {checkOut}.",
      helpTitle: "Not sure which room is right?",
      helpBody: "Search your dates to see what’s free — or tell us about your trip and our front desk will suggest the best fit.",
    },
    hotel: {
      kicker: "The hotel",
      title: "Comfort, style and excellence in Mwenge",
      intro: "{hotelName} sits at {address}, {city} — a practical, polished base for business and leisure.",
      image: { src: "/images/exterior/exterior-01.webp", alt: "Vegas Luxury Hotel building exterior" },
      aboutKicker: "About us",
      aboutTitle: "Everything you need, nothing you don’t",
      about: [
        "Our {rooms} rooms across {roomTypes} room types all include air conditioning, a private bathroom, a TV, a work desk, a tea and coffee maker, free Wi-Fi and free breakfast.",
        "You’ll also find our restaurant and bar, a private meeting room and a 24-hour reception. We offer room service, housekeeping, free on-site parking and airport transfers with our own drivers — Julius Nyerere International Airport is about {airportKm} km away.",
      ],
      images: [
        { src: "/images/exterior/exterior-04.webp", alt: "Balconies of Vegas Luxury Hotel against a blue sky" },
        { src: "/images/lobby/lobby-03.webp", alt: "Reception desk and world clocks in the lobby" },
        { src: "/images/amenity/amenity-02.webp", alt: "Sofa, oval mirror and a hotel bathrobe in a guest room" },
        { src: "/images/amenity/amenity-03.webp", alt: "Desk, kettle, mini fridge and room phone" },
      ],
      servicesTitle: "At your service",
    },
    gallery: {
      kicker: "Gallery",
      title: "Inside Vegas Luxury Hotel",
      intro: "Rooms, suites with jacuzzi bathtubs, our reception, the meeting room and the building itself — every photo here is of our hotel.",
      image: { src: "/images/room-red/room-red-06.webp", alt: "Tea and coffee tray by the window in a suite" },
    },
    restaurant: {
      kicker: "The restaurant",
      title: "A table for every part of the day",
      intro: "From the first coffee of the morning to cocktail hour and dinner, with dishes from across Africa and around the world.",
      cuisinesTitle: "A menu that travels",
      cuisinesBody: "African favourites sit alongside American, Chinese and Spanish dishes, pizza, sushi and food from the grill.",
      mealsTitle: "Morning to night",
      breakfastNote: "Breakfast is included for hotel guests with every room booking.",
      closingTitle: "Planning a meal, a celebration or a working lunch?",
      closingBody: "Get in touch and our team will help.",
      cuisines: ["African", "American", "Chinese", "Pizza", "Spanish", "Sushi", "Grill / BBQ"],
      meals: ["Breakfast", "Brunch", "Lunch", "High tea", "Cocktail hour", "Dinner"],
      dietary: ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free"],
    },
    bar: {
      kicker: "The bar",
      title: "Slow down, the day is done",
      intro: "Our bar is a relaxed place to end the day — to meet a colleague, catch up with friends or simply sit back before dinner.",
      points: [
        { title: "Right here", body: "The bar is inside the hotel — no taxi needed at the end of a long day." },
        { title: "Cocktail hour", body: "Our restaurant also hosts a cocktail hour, so an evening can flow easily into dinner." },
        { title: "Stay the night", body: "Rooms upstairs include free breakfast and Wi-Fi, when one more drink turns into a stay." },
      ],
      closingTitle: "We look forward to welcoming you",
    },
    meeting: {
      kicker: "Meet & work",
      fallbackName: "Meeting Room",
      fallbackDescription: "A private meeting room for meetings and workshops.",
      whyTitle: "Useful things, close together",
      why: [
        { icon: "MapPinned", title: "Easy to find", body: "At Mlimani City Roundabout, behind Mwenge Tower." },
        { icon: "CircleParking", title: "Free parking", body: "Free private parking on site." },
        { icon: "UtensilsCrossed", title: "Restaurant on site", body: "Breakfast, lunch, high tea and dinner under one roof." },
        { icon: "Plane", title: "Airport transfers", body: "Guests flying in can be collected by our own drivers." },
      ],
      stepsTitle: "Three simple steps",
      steps: [
        { title: "Tell us your plans", body: "Send your preferred date, times and number of people." },
        { title: "We confirm", body: "Our team confirms availability and the details with you." },
        { title: "Meet", body: "Arrive at {hotelName} — we’ll have the room ready." },
      ],
    },
    contact: {
      kicker: "Contact",
      title: "We’re here, day and night",
      intro: "Our reception is open 24 hours. Call, WhatsApp or send us a message — we’ll get back to you as soon as we can.",
      image: { src: "/images/lobby/lobby-02.webp", alt: "Reception at Vegas Luxury Hotel" },
      formTitle: "Send us a message",
      formIntro: "For bookings, meeting room enquiries, airport transfers or anything else.",
    },
    book: {
      intro: "Choose your dates and guests to see live availability and prices. Pay now by mobile money to reserve your room, or pay later.",
      pausedIntro: "Online booking is paused right now. Our front desk will happily reserve your room directly.",
    },
    footer: {
      // One line about the hotel (no payment promise: guests can now also pay online).
      blurb: "Refined rooms, a restaurant and bar, and a warm welcome at Mlimani City, Dar es Salaam.",
    },
  },
};

export type SiteContent = typeof DEFAULT_CONTENT;

// Live content (defaults + manager edits + DB services/gallery) is served by
// `getSiteContent()` in src/server/services/site-content.ts — kept out of this
// module because client components import its constants.

/** Fill `{placeholder}` tokens in content strings. Unknown tokens are left as-is. */
export function fill(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}
