import type { Catalog } from "../../../translate";

// Fixes in the server services (svc-b): nTZS refusals shown to staff when a mobile-money request cannot start
// (ntzs.ts → mobile-payments.ts), and quantities in the reports ("2 bottles": the number, then the unit's word).
const catalog: Catalog = {
  // nTZS refusals — {reason}, {code} and {message} come from nTZS; {amount} is the smallest amount it takes
  "nTZS did not answer ({reason}) — try again.": "nTZS 没有响应（{reason}）——请重试。",
  "timed out": "超时",
  "The amount must be at least TZS {amount}.": "金额至少为 TZS {amount}。",
  "nTZS refused this request ({code}) — {message}.": "nTZS 拒绝了此请求（{code}）——{message}。",
  "nTZS refused this request ({code}).": "nTZS 拒绝了此请求（{code}）。",

  // Reports — a quantity with its unit ("2 瓶", "1.5 kg")
  "{n} {unit}": "{n} {unit}",
};
export default catalog;
