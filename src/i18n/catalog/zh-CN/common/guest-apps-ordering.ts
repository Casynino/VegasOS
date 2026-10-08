import type { Catalog } from "../../../translate";

// Print / PDF / image / share for a bill or receipt — the same buttons for guests (their receipt, their room bill) and
// for staff (printed bills), so they live in the common bundle.
const catalog: Catalog = {
  "Print": "打印",
  "Image": "图片",
  "Share": "分享",
  "Could not make the PDF — try again.": "无法生成 PDF——请重试。",
  "Could not make the image — try again.": "无法生成图片——请重试。",
  "Could not share the bill — download it instead.": "无法分享账单——请改为下载。",
};
export default catalog;
