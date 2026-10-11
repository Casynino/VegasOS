import { describe, expect, it } from "vitest";
import {
  breakfastFor, buildHousekeepingRows, classifyRoom, guestTotals, housekeepingTotals, listKindOf, listNumber, needsCleaning,
  occupiedServiceOf, sortGuestRows, type GuestRow, type HkRoomInput,
} from "./daily-lists";

const room = (over: Partial<HkRoomInput> & { room: string }): HkRoomInput => ({
  roomId: `r-${over.room}`, type: "Double Deluxe", floor: 1, status: "READY", statusNote: null, statusChangedAt: "2026-10-11T05:00:00.000Z",
  stay: null, arrivalToday: false, request: null, block: null, ...over,
});
const stay = (state: "IN_HOUSE" | "DUE_TODAY" | "OVERDUE") => ({ state, leavesOn: "2026-10-12", leavesAt: "2026-10-12T07:00:00.000Z" });

describe("housekeeping checklist — where a room goes", () => {
  it("a room marked as needing cleaning, or being cleaned, is check-out cleaning", () => {
    expect(classifyRoom(room({ room: "201", status: "DIRTY" })).group).toBe("CHECKOUT");
    expect(classifyRoom(room({ room: "202", status: "CLEANING" })).group).toBe("CHECKOUT");
  });

  it("a guest leaving today, or past the check-out time, is check-out cleaning", () => {
    expect(classifyRoom(room({ room: "201", status: "OCCUPIED", stay: stay("DUE_TODAY") })).group).toBe("CHECKOUT");
    expect(classifyRoom(room({ room: "202", status: "OCCUPIED", stay: stay("OVERDUE") })).group).toBe("CHECKOUT");
  });

  it("a guest staying on is an occupied room, never an automatic full clean", () => {
    const row = classifyRoom(room({ room: "201", status: "OCCUPIED", stay: stay("IN_HOUSE") }));
    expect(row.group).toBe("OCCUPIED");
    expect(needsCleaning(row, "DAILY")).toBe(true);
    expect(needsCleaning(row, "ON_REQUEST")).toBe(false);
    // On request: only when the guest asked.
    expect(needsCleaning({ ...row, request: "Please clean at 10" }, "ON_REQUEST")).toBe(true);
  });

  it("clean rooms are listed as ready and never as work", () => {
    for (const status of ["READY", "AVAILABLE"] as const) {
      const row = classifyRoom(room({ room: "201", status }));
      expect(row.group).toBe("READY");
      expect(needsCleaning(row, "DAILY")).toBe(false);
    }
  });

  it("closed rooms need attention and are never ready", () => {
    const m = classifyRoom(room({ room: "201", status: "MAINTENANCE", statusNote: "AC broken" }));
    expect(m).toMatchObject({ group: "ATTENTION", reason: "AC broken" });
    expect(needsCleaning(m, "DAILY")).toBe(false);
    expect(classifyRoom(room({ room: "202", status: "OUT_OF_SERVICE" })).group).toBe("ATTENTION");
    // A closure planned for today on a room still marked ready.
    const planned = classifyRoom(room({ room: "203", status: "READY", block: { type: "MAINTENANCE", reason: "Painting", until: "2026-10-14" } }));
    expect(planned).toMatchObject({ group: "ATTENTION", closure: "MAINTENANCE", reason: "Painting", closedUntil: "2026-10-14" });
  });

  it("when the room's status and the bookings disagree, reception looks first", () => {
    expect(classifyRoom(room({ room: "201", status: "OCCUPIED" }))).toMatchObject({ group: "ATTENTION", mismatch: "NO_GUEST" });
    expect(classifyRoom(room({ room: "202", status: "READY", stay: stay("IN_HOUSE") }))).toMatchObject({ group: "ATTENTION", mismatch: "GUEST_IN" });
    expect(classifyRoom(room({ room: "203", status: "MAINTENANCE", stay: stay("IN_HOUSE") }))).toMatchObject({ group: "ATTENTION", mismatch: "GUEST_IN" });
  });
});

describe("housekeeping checklist — order and totals", () => {
  const rooms = [
    room({ room: "305", status: "READY" }),
    room({ room: "210", status: "OCCUPIED", stay: stay("IN_HOUSE") }),
    room({ room: "9", status: "DIRTY" }),
    room({ room: "104", status: "OCCUPIED", stay: stay("DUE_TODAY") }),
    room({ room: "301", status: "DIRTY", arrivalToday: true }),
    room({ room: "12", status: "CLEANING" }),
    room({ room: "208", status: "OCCUPIED", stay: stay("IN_HOUSE"), request: "Towels and a clean" }),
    room({ room: "111", status: "MAINTENANCE", statusNote: "Leak" }),
    room({ room: "101", status: "AVAILABLE" }),
  ];
  const rows = buildHousekeepingRows(rooms);

  it("lists every room once, parts in print order", () => {
    expect(rows).toHaveLength(rooms.length);
    expect(new Set(rows.map((r) => r.room)).size).toBe(rooms.length);
    expect(rows.map((r) => r.group)).toEqual(["CHECKOUT", "CHECKOUT", "CHECKOUT", "CHECKOUT", "OCCUPIED", "OCCUPIED", "READY", "READY", "ATTENTION"]);
  });

  it("check-outs: a guest arriving today first, then rooms free to clean, then rooms the guest has yet to leave", () => {
    expect(rows.filter((r) => r.group === "CHECKOUT").map((r) => r.room)).toEqual(["301", "9", "12", "104"]);
  });

  it("occupied rooms: the ones where the guest asked come first; numbers sort as numbers", () => {
    expect(rows.filter((r) => r.group === "OCCUPIED").map((r) => r.room)).toEqual(["208", "210"]);
    expect(rows.filter((r) => r.group === "READY").map((r) => r.room)).toEqual(["101", "305"]);
  });

  it("totals follow the hotel's rule for occupied rooms", () => {
    expect(housekeepingTotals({ rows, occupiedService: "DAILY" })).toEqual({
      listed: 9, checkout: 4, waiting: 2, inProgress: 1, occupied: 2, occupiedService: 2, ready: 2, attention: 1, toClean: 6,
    });
    expect(housekeepingTotals({ rows, occupiedService: "ON_REQUEST" })).toMatchObject({ occupied: 2, occupiedService: 1, toClean: 5, ready: 2 });
  });
});

describe("in-house guest & breakfast list", () => {
  const guest = (over: Partial<GuestRow> & { room: string }): GuestRow => ({
    type: "Double Deluxe", name: "Amina Juma", others: [], bookingRooms: 1, group: null, company: null, adults: 1, children: 0,
    checkedInAt: "2026-10-10T12:00:00.000Z", arrival: "2026-10-10", nights: 2, shortTime: false, leavesOn: "2026-10-12", leavesAt: "2026-10-12T07:00:00.000Z",
    stay: "IN_HOUSE", breakfast: "INCLUDED", request: null, ...over,
  });

  it("breakfast is never invented", () => {
    expect(breakfastFor({ shortTime: false }, true)).toBe("INCLUDED");
    expect(breakfastFor({ shortTime: false }, false)).toBe("NOT_RECORDED");
    expect(breakfastFor({ shortTime: true }, true)).toBe("NONE_SHORT_TIME");
    expect(breakfastFor({ shortTime: true }, false)).toBe("NONE_SHORT_TIME");
  });

  it("counts rooms and people apart", () => {
    const rows = [
      guest({ room: "201", adults: 2, children: 1 }),
      guest({ room: "202", adults: 1, stay: "DUE_TODAY" }),
      guest({ room: "203", adults: 2, shortTime: true, breakfast: "NONE_SHORT_TIME" }),
      guest({ room: "204", adults: 3, breakfast: "NOT_RECORDED", stay: "OVERDUE" }),
    ];
    expect(guestTotals(rows)).toEqual({
      rooms: 4, guests: 9, adults: 8, children: 1, breakfastRooms: 2, breakfastGuests: 4, noBreakfastRooms: 1, unknownRooms: 1, unknownGuests: 3, leaving: 2,
    });
  });

  it("an empty hotel is all zeros", () => {
    expect(guestTotals([])).toMatchObject({ rooms: 0, guests: 0, breakfastGuests: 0, unknownRooms: 0, leaving: 0 });
  });

  it("sorts by room number, as numbers", () => {
    expect(sortGuestRows([guest({ room: "210" }), guest({ room: "9" }), guest({ room: "101" })]).map((r) => r.room)).toEqual(["9", "101", "210"]);
  });
});

describe("names and numbers", () => {
  it("numbers a printed copy by list, day and copy", () => {
    expect(listNumber("HOUSEKEEPING", "2026-10-11", 2)).toBe("HK-20261011-2");
    expect(listNumber("GUESTS", "2026-10-11", 1)).toBe("GL-20261011-1");
  });

  it("reads the list from its address and the rule from the setting", () => {
    expect(listKindOf("housekeeping")).toBe("HOUSEKEEPING");
    expect(listKindOf("guests")).toBe("GUESTS");
    expect(listKindOf("money")).toBeNull();
    expect(occupiedServiceOf("ON_REQUEST")).toBe("ON_REQUEST");
    expect(occupiedServiceOf("anything else")).toBe("DAILY");
    expect(occupiedServiceOf(null)).toBe("DAILY");
  });
});
