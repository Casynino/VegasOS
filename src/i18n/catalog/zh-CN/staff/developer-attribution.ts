// Developer account: who is named in the audit trail (failed sign-ins are the system's entry, manual report runs and sends carry the real person), and the two sign-in failure texts.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // The answer on the Developer door (the Staff door keeps its original text, "Incorrect email or password.")
  "Incorrect email or password for the Developer account.": "开发者账号的邮箱或密码不正确。",

  // A failed sign-in: nobody is signed in, so the entry is the system's and names the account only as the record it was about
  "Sign-in page (not signed in)": "登录页面（未登录）",
  "Failed sign-in (not signed in)": "登录失败（未登录）",

  // The Developer's own entries
  "opened very many pages in a short time (not every page is listed)": "短时间内打开了大量页面（并非每个页面都会列出）",
  "exported records to a file": "将记录导出为文件",
  "downloaded a file": "下载了文件",

  // Staff accounts
  "changed a staff account's details": "修改了员工账号的资料",
  "changed a staff account's role": "修改了员工账号的角色",
  "switched a staff account off": "停用了员工账号",
  "switched a staff account back on": "重新启用了员工账号",

  // Reports made or sent by hand (under the real person's name)
  "made the room report": "生成了房间报告",
  "regenerated the room report": "重新生成了房间报告",
  "sent the daily report to the recipients": "将日报发送给了收件人",
  "sent the room report to the recipients": "将房间报告发送给了收件人",
  "sent a shift report to the recipients": "将班次报告发送给了收件人",
  "sent a staff report to the recipients": "将员工报告发送给了收件人",
};

export default catalog;
