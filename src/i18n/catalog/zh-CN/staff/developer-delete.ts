// Delete an account (Developer, Access page): access and the account go, the records stay under the person's name; permanent owners can't be suspended or deleted.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "Delete {name}": "删除 {name}",
  "Delete {name}?": "删除 {name}？",
  "Account deleted.": "账号已删除。",
  "Can't be suspended or deleted: this is a permanent owner of the system.": "无法暂停或删除：这是系统的永久所有者。",
  "This is the only Boss account that is switched on — the top authority must always be kept. Add or promote another Boss first.": "这是唯一启用的老板账号——必须始终保留最高权限。请先添加或提升另一个老板账号。",
  "{developer} (Developer) deleted the account of {person} ({role}) at {time}. Everything they did stays recorded under their name.": "{developer}（开发者）于 {time} 删除了 {person}（{role}）的账号。其做过的一切仍以其姓名保留在记录中。",
  "{name} loses all access and is removed from the system. Everything {name} did stays recorded under their name.": "{name} 将失去所有访问权限并从系统中移除。{name} 做过的一切仍以其姓名保留在记录中。",
  "Permanent owner: can't be suspended or deleted": "永久所有者：不能被暂停或删除",
  "The only Boss: can't be suspended or deleted": "唯一的老板：不能被暂停或删除",
  "Can't sign a permanent owner out here": "不能在此让永久所有者退出登录",
};

export default catalog;
