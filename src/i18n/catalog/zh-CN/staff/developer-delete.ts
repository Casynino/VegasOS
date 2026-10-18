// Delete an account (Developer, Access page): access and the account go, the records stay under the person's name; permanent owners can't be suspended or deleted.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "Delete {name}": "删除 {name}",
  "Delete {name}?": "删除 {name}？",
  "{name} loses all access and the account is removed from the system. Everything {name} did stays recorded under their name. This cannot be undone. The Boss is told.": "{name} 将失去所有访问权限，账号将从系统中移除。{name} 做过的一切仍以其姓名保留在记录中。此操作无法撤销。将通知老板。",
  "Type DELETE to go on": "输入 DELETE 以继续",
  "Type DELETE, in capital letters, to go on.": "请用大写字母输入 DELETE 以继续。",
  "Account deleted.": "账号已删除。",
  "Can't be suspended or deleted: this is a permanent owner of the system.": "无法暂停或删除：这是系统的永久所有者。",
  "This is the only Boss account that is switched on — there must always be one. Add or promote another Boss first.": "这是唯一启用的老板账号——必须始终保留一个。请先添加或提升另一个老板账号。",
  "{developer} (Developer) deleted the account of {person} ({role}) at {time}. Reason: {reason}. Everything they did stays recorded under their name.": "{developer}（开发者）于 {time} 删除了 {person}（{role}）的账号。原因：{reason}。其做过的一切仍以其姓名保留在记录中。",
  "Permanent owner: can't be suspended or deleted": "永久所有者：不能被暂停或删除",
  "The only Boss: can't be suspended or deleted": "唯一的老板：不能被暂停或删除",
  "Type DELETE to delete this account.": "请输入 DELETE 以删除此账号。",
  "Type DELETE exactly.": "请准确输入 DELETE。",
  "Can't sign a permanent owner out here": "不能在此让永久所有者退出登录",
};

export default catalog;
