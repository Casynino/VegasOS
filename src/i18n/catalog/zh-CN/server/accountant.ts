// Server: the cash handover steps — success messages, validation and errors.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "Handover sent to the Accountant.": "已提交给会计。",
  "Handover sent again.": "已重新提交。",
  "Cash received.": "已收到现金。",
  "Say why — at least 5 letters.": "请说明原因——至少 5 个字。",
  "Sent back to be corrected.": "已退回更正。",
  "Handover refused.": "已拒绝该交接。",
  "Enter the amount as a whole number of shillings.": "请输入整数先令金额。",
  "Say why ({what}) — at least {n} letters.": "请说明原因（{what}）——至少 {n} 个字。",
  "There is no active cash account. Ask the administrator to set one up.": "没有可用的现金账户。请联系管理员设置。",
  "You are handing over TZS {amount} less than the cash recorded. Explain the difference.": "您上交的现金比记录少 TZS {amount}。请说明差额原因。",
  "You are handing over TZS {amount} more than the cash recorded. Explain the difference.": "您上交的现金比记录多 TZS {amount}。请说明差额原因。",
  "There is nothing to hand over yet.": "目前没有可上交的内容。",
  "You have no cash to hand over — no cash was recorded since your last handover.": "您没有可上交的现金——自上次交接以来没有记录现金。",
  "The cash refunded is more than the cash collected in this period. Ask the Accountant.": "本期已退现金多于已收现金。请联系会计。",
  "Handover not found.": "找不到该交接。",
  "Only a handover that was sent back can be sent again.": "只有已退回的交接才能重新提交。",
  "This handover was already sent again.": "这笔交接已重新提交。",
  "You cannot receive your own handover.": "您不能收取自己的交接。",
  "This handover is not waiting to be received.": "这笔交接当前不在待收取状态。",
  "The cash received is short by TZS {amount}. Explain the difference.": "实收现金少 TZS {amount}。请说明差额原因。",
  "The cash received is over by TZS {amount}. Explain the difference.": "实收现金多 TZS {amount}。请说明差额原因。",
  "Choose an active cash account for the cash received.": "请为收到的现金选择一个可用的现金账户。",
  "This handover was already received.": "这笔交接已收取。",
  "You cannot review your own handover.": "您不能审核自己的交接。",
  "This handover cannot be refused any more.": "这笔交接已不能再拒绝。",
  "A later handover already follows this one. Send this one back instead of refusing it.": "之后已有交接接续这一笔。请退回更正，而不是拒绝。",
  "This handover was changed just now. Open it again.": "这笔交接刚刚发生变化，请重新打开。",
};
export default catalog;
