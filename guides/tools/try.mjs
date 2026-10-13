// Scratch list for trying one flow at a time.
import fs from "node:fs";
const T = JSON.parse(fs.readFileSync(new URL("./tokens.json", import.meta.url), "utf8"));
const P = (id, spec) => ({ id, view: "phone", ...spec });
const D = (id, url, spec = {}) => ({ id, view: "desk", h: 860, url, ...spec });
export const SHOTS = [
  P("g-room-1", { url: `/r/${T.room203}`, marks: [[1, "Order food & drinks"], [2, "Wi-Fi"], [3, "Reception"], [4, "Full bill"]] }),
  P("g-room-2", { scroll: "Ask here and reception takes care of it.", marks: [[1, "Late check-out", { at: "l" }], [2, "Cleaning", { at: "l" }], [3, "Something else", { at: "l" }]] }),
  P("g-room-3", { steps: [{ click: "Cleaning", then: 1800 }] }),
  P("g-hotel-1", { url: `/b/${T.hotel}`, marks: [[1, "Check availability"], [2, "Explore rooms"]] }),
  P("g-hotel-2", { scroll: "Our rooms", marks: [[1, "Book##2"], [2, "Details##2"]] }),
  D("web-home", "/"),
  D("web-rooms", "/rooms"),
  D("web-menu", "/menu"),
  D("web-restaurant", "/restaurant"),
  D("web-transport", "/transport"),
  D("web-meeting", "/meeting-room"),
  D("web-contact", "/contact"),
  D("web-gallery", "/gallery"),
];
