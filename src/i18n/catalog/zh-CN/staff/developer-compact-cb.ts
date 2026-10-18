// Developer Home, the compact arrangement of System checks, Errors & jobs and Sign-ins & security: one line of chips instead of big cards,
// lists and charts drawn only when they have something to show.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // System checks: the summary line
  "{ok} of {n} checks fine": "{n} 项检查中 {ok} 项正常",
  "{n} needs fixing": "{n} 项需要修复",
  "{n} need fixing": "{n} 项需要修复",
  "{n} to look at": "{n} 项需要留意",
  "{n} could not be checked": "{n} 项无法检查",
  // Errors & jobs
  "Last 30 days, one line for each different error.": "最近 30 天，每种不同的错误占一行。",
  "Runs by itself on a timer. Hotel time.": "按定时器自动运行。酒店时间。",
  "No automatic job has run since the system started recording.": "自系统开始记录以来，没有任何自动任务运行过。",
  "No message from other services has arrived yet.": "尚未收到来自其他服务的消息。",
  // Sign-ins & security: the summary line and the list of failed tries
  "Failed sign-ins in 14 days: {n}": "14 天内登录失败：{n}",
  "Successful: {n}": "登录成功：{n}",
  "Locked out now: {n}": "当前被锁定：{n}",
  "Refused to you: {n}": "被拒绝的操作：{n}",
  "No wrong tries in the last 7 days": "最近 7 天没有输错的尝试",
  "Failed tries": "失败的尝试",
  "One address trying many accounts is a warning sign.": "同一个地址尝试多个账户是危险信号。",
  "Accounts tried": "被尝试的账户",
  "Last try": "最近一次尝试",
  "No address on record": "没有记录地址",
};

export default catalog;
