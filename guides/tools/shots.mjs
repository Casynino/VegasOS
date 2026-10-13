// The list of pictures for the guide books. Each one: who is signed in (a practice account), which page, which size,
// what to press before the picture, and where the numbered marks go.
const REC = "neema@vegas.test";
const WTR = "baraka@vegas.test";
const CTR = "counter@vegas.test";
const CHEF = "chef@vegas.test";
const MGR = "manager@vegas.test";
const MD = "admin@vegas.test";
const BOSS = "owner@vegas.test";

export const SHOTS = [
  // first look — one home per role
  { id: "x-rec-home", as: REC, url: "/reception/dashboard" },
  { id: "x-wtr-home", as: WTR, url: "/staff", view: "phone" },
  { id: "x-ctr-home", as: CTR, url: "/staff", view: "tablet" },
  { id: "x-chef-home", as: CHEF, url: "/staff", view: "tablet" },
  { id: "x-mgr-home", as: MGR, url: "/staff" },
  { id: "x-md-home", as: MD, url: "/staff" },
  { id: "x-boss-home", as: BOSS, url: "/staff" },
  { id: "x-web-home", url: "/en", view: "phone" },
];
