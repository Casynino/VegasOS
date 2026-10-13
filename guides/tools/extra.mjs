// Late additions to the picture list.
const L = { at: "l" };
const ASHA = "asha@vegas.test";
export const SHOTS = [
  { id: "r-start", as: "neema@vegas.test", view: "desk", h: 900, url: "/reception/dashboard", marks: [[1, "Start my shift"], [2, "AT THE DESK", L], [3, "What's going on", L]] },
  { id: "k-gift-card", as: "chef@vegas.test", view: "tablet", h: 1060, url: "/staff/restaurant", clip: ["Spin to Win · #13", "Nothing to pay"], pad: 120 },
  { id: "r-home-n", as: ASHA, view: "desk", h: 980, url: "/reception/dashboard", marks: [[1, "New booking"], [2, "css:a[href$='/check-in']##2"], [3, "css:a[href$='/check-out']##2"], [4, "Guest request"], [5, "On shift"], [6, "Print Housekeeping Checklist"], [7, "NEEDS YOUR ATTENTION", L]] },
  { id: "r-rooms-n", as: ASHA, view: "desk", h: 980, url: "/staff/rooms", marks: [[1, "Available"], [2, "Occupied"], [3, "Needs cleaning"], [4, "Room QR codes"]] },
];
