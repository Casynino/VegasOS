import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the background timers DO in a quiet session (a Developer's) and in an ordinary one. The hooks are run directly (no browser): useEffect runs
 * at once, state is a plain value, and the flag is whatever the test says the layout handed down. Fake timers show whether a timer was started
 * and what it does when it fires.
 */
const world = vi.hoisted(() => ({ quiet: false, cleanups: [] as (() => void)[], refresh: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useContext: () => world.quiet,
    useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (typeof cleanup === "function") world.cleanups.push(cleanup); },
    useRef: <T,>(current: T) => ({ current }),
    useState: <T,>(initial: T) => [initial, () => undefined] as const,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: world.refresh, push: vi.fn() }), usePathname: () => "/staff" }));
vi.mock("@/components/staff/sound-actions", () => ({ setAlertSoundAction: vi.fn() }));

import { LiveRefresh } from "@/components/live-refresh";
import { LiveRefresh as CommandCenterRefresh } from "@/components/dashboard/command-center-list";
import { useLiveOrders } from "@/components/staff/sounds";
import { StaffAlerts } from "@/components/staff/staff-alerts";

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ v: "1" }) }));
const SOUND = { enabled: true, volume: 0.5, newSound: "bell", readySound: "chime" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { visibilityState: "visible", hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("fetch", fetchMock);
  world.quiet = false;
  world.cleanups.length = 0;
  world.refresh.mockClear();
  fetchMock.mockClear();
});
afterEach(() => {
  world.cleanups.splice(0).forEach((c) => c());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the page that refreshes itself (order pages, the POS, requests, the money pages that follow a withdrawal)", () => {
  it("a Developer's session: no timer is started and the page is never refreshed by itself", () => {
    world.quiet = true;
    LiveRefresh({ every: 10, active: true });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(world.refresh).not.toHaveBeenCalled();
  });

  it("staff: it refreshes every N seconds while the page is visible, exactly as before — and not while the tab is hidden or the page is finished", () => {
    LiveRefresh({ every: 10, active: true });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(world.refresh).toHaveBeenCalledTimes(3);
    vi.stubGlobal("document", { visibilityState: "hidden", addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.advanceTimersByTime(30_000);
    expect(world.refresh).toHaveBeenCalledTimes(3);
    world.cleanups.splice(0).forEach((c) => c());
    world.quiet = false;
    LiveRefresh({ every: 10, active: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("management's live view (every minute)", () => {
  it("a Developer's session: no timer, no refresh", () => {
    world.quiet = true;
    CommandCenterRefresh({});
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(world.refresh).not.toHaveBeenCalled();
  });

  it("staff: refreshes every minute, as before", () => {
    CommandCenterRefresh({});
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3 * 60_000);
    expect(world.refresh).toHaveBeenCalledTimes(3);
  });
});

describe("the order boards (tables, reservations, the restaurant portal): useLiveOrders", () => {
  it("a Developer's session: no question to the server, no timer, no full reload", () => {
    world.quiet = true;
    const refresh = vi.fn();
    useLiveOrders(refresh, 3000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("staff: asks at once, then every few seconds, and reloads every 30 seconds as a safety net — as before", async () => {
    const refresh = vi.fn();
    useLiveOrders(refresh, 3000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the first question, at once
    expect(vi.getTimerCount()).toBe(2); // the question and the safety net
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(refresh).toHaveBeenCalledTimes(1); // the 30-second safety net
  });
});

describe("the bell (StaffAlerts)", () => {
  it("a Developer's session: the bell is not drawn at all — nothing to poll, nothing to ring", () => {
    expect(StaffAlerts({ sound: SOUND, soundOff: false, quiet: true })).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("staff: the bell is drawn (and polls, as before)", () => {
    const bell = StaffAlerts({ sound: SOUND, soundOff: false }) as { type: unknown } | null;
    expect(bell).not.toBeNull();
    expect(typeof bell?.type).toBe("function");
    expect(StaffAlerts({ sound: SOUND, soundOff: false, quiet: false })).not.toBeNull();
  });
});
