import { describe, expect, it } from "vitest";
import { deliveryErrorKind, ERROR_TEXT_MAX, maskPhone, scrubError } from "./console-scrub";

describe("a phone number on the Developer console", () => {
  it("shows only its last three digits", () => {
    expect(maskPhone("+255700000412")).toBe("•••• 412");
    expect(maskPhone("255 700 000 412")).toBe("•••• 412");
    expect(maskPhone("0712-345-678")).toBe("•••• 678");
  });
  it("shows nothing real when there is almost nothing", () => {
    expect(maskPhone("12")).toBe("••••");
    expect(maskPhone("")).toBe("••••");
    expect(maskPhone(null)).toBe("••••");
    expect(maskPhone(undefined)).toBe("••••");
  });
  it("never lets more than three digits through", () => {
    expect(maskPhone("+255700000412").replace(/\D/g, "")).toHaveLength(3);
  });
});

describe("a provider's error text on the Developer console", () => {
  it("is cut to 120 characters", () => {
    const out = scrubError(`CallMeBot: ${"word ".repeat(80)}`)!;
    expect(out.length).toBeLessThanOrEqual(ERROR_TEXT_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
  it("loses a key written as key=value, a bearer token and a long token", () => {
    expect(scrubError("Invalid apikey=ABCDEF123456 sorry")).toBe("Invalid apikey=••• sorry");
    expect(scrubError("denied: Bearer sk_live_9f8e7d6c5b4a")).toBe("denied: bearer •••");
    expect(scrubError("token xK3jL9mQ2pR7vB4nT8wY1zA6cD5eF0gH was refused")).toBe("token ••• was refused");
    expect(scrubError("password: hunter2 and secret=abc")).toBe("password=••• and secret=•••");
  });
  it("loses a key or a value that is quoted, as in JSON", () => {
    expect(scrubError('{"apiKey":"ABCDEF123456"}')).not.toContain("ABCDEF123456");
    expect(scrubError(`{"token": "abc123", "ok": false}`)).not.toContain("abc123");
    expect(scrubError(`'secret' = 'hush-hush'`)).not.toContain("hush-hush");
    expect(scrubError('Authorization: "Basic dXNlcjpwYXNz"')).not.toContain("dXNlcjpwYXNz");
    expect(scrubError('{"password" : hunter2}')).not.toContain("hunter2");
  });
  it("loses any number of more than eight digits, however it is spaced", () => {
    expect(scrubError("to 255700000412 failed")).toBe("to ••• failed");
    expect(scrubError("to +255 700 000 412 failed")).toBe("to ••• failed");
    expect(scrubError("to 0712-345-678 failed")).toBe("to ••• failed");
  });
  it("keeps small numbers (a status code, a count of tries)", () => {
    expect(scrubError("HTTP 502 after 3 tries")).toBe("HTTP 502 after 3 tries");
  });
  it("takes out markup and is null when there is nothing left", () => {
    expect(scrubError("<b>Error</b>  <i>x</i>")).toBe("Error x");
    expect(scrubError("")).toBeNull();
    expect(scrubError("   ")).toBeNull();
    expect(scrubError(null)).toBeNull();
    expect(scrubError(42)).toBeNull();
  });
});

describe("the kind of trouble a delivery had", () => {
  it("is told in plain words", () => {
    expect(deliveryErrorKind("No CallMeBot API key configured (CALLMEBOT_KEY_BOSS).")).toBe("No provider key set");
    expect(deliveryErrorKind("Recipient must be an international number like +255…")).toBe("Phone number not accepted");
    expect(deliveryErrorKind("Unsupported channel EMAIL")).toBe("Channel not supported");
    expect(deliveryErrorKind("CallMeBot request failed: The operation was aborted due to timeout")).toBe("The provider did not answer");
    expect(deliveryErrorKind("CallMeBot: APIKey is invalid")).toBe("The provider refused it");
    expect(deliveryErrorKind("CallMeBot: You have exceeded the message limit, wait 10 minutes")).toBe("Message limit reached");
    expect(deliveryErrorKind("CallMeBot request failed: fetch failed")).toBe("The provider did not answer");
    expect(deliveryErrorKind("something odd")).toBe("Other problem");
    expect(deliveryErrorKind(null)).toBe("No answer recorded");
    expect(deliveryErrorKind("  ")).toBe("No answer recorded");
  });
});

describe("a reply that echoes the hotel's own message", () => {
  // CallMeBot repeats the message it was given ("Message to … Text to send …") and says what it did at the END; the stored error is the last 220 characters.
  const echo = "CallMeBot: Message to: +255700000999 Text to send: Dear Asha, your room 103 is ready, balance TZS 45,000 - Vegas Luxury Hotel. APIKey is invalid";
  it("is given a kind from its end, and the kind carries none of the message's words", () => {
    const kind = deliveryErrorKind(echo);
    expect(kind).toBe("The provider refused it");
    for (const w of ["Asha", "room 103", "45,000", "255700000999", "Dear"]) expect(kind).not.toContain(w);
  });
  it("a hotel word that looks like a trouble does not decide the kind of a system message", () => {
    expect(deliveryErrorKind("No CallMeBot API key configured (CALLMEBOT_KEY_BOSS).")).toBe("No provider key set");
    expect(deliveryErrorKind("Unsupported channel SMS limit exceeded")).toBe("Channel not supported");
  });
});
