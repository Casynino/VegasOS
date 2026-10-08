import type { Catalog } from "../../../translate";

// The website's stay search, checked on the server (public-booking parseStayParams) and shown under the fields of the
// search form in the guest's browser — so these are in the public bundle.
const catalog: Catalog = {
  "Choose a check-in date.": "请选择入住日期。",
  "Check-in cannot be in the past.": "入住日期不能是过去的日期。",
  "That date is too far ahead to book online.": "该日期太远，无法在线预订。",
  "Choose a check-out date.": "请选择退房日期。",
  "Check-out must be after check-in.": "退房日期必须晚于入住日期。",
  // These three carry the hotel's fixed limits (MAX_NIGHTS 90, MAX_ADULTS 20, MAX_CHILDREN 10) in the English the form
  // receives — keyed with those numbers. If a limit changes, change the key here too (else the English shows).
  "Online bookings are limited to 90 nights.": "在线预订最多 90 晚。",
  "Adults must be between 1 and 20.": "成人人数须在 1 至 20 之间。",
  "Children must be between 0 and 10.": "儿童人数须在 0 至 10 之间。",
};
export default catalog;
