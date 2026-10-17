// Developer "Work as": what the server says when it refuses something while a Developer works as someone, and the Boss's notice.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // The refusals (server/auth.ts assertNotWorkAs: "While you are working as someone you cannot …")
  "While you are working as someone you cannot create accounts.": "以他人身份工作期间，您不能创建账号。",
  "While you are working as someone you cannot change accounts, roles or login emails.": "以他人身份工作期间，您不能更改账号、角色或登录邮箱。",
  "While you are working as someone you cannot change a password.": "以他人身份工作期间，您不能更改密码。",
  "While you are working as someone you cannot change roles or rights.": "以他人身份工作期间，您不能更改角色或权限。",
  "While you are working as someone you cannot remove accounts.": "以他人身份工作期间，您不能删除账号。",
  "While you are working as someone you cannot change a name, a phone number or a login email.": "以他人身份工作期间，您不能更改姓名、电话号码或登录邮箱。",
  "While you are working as someone you cannot sign people out of their devices.": "以他人身份工作期间，您不能让他人在其设备上退出登录。",
  "While you are working as someone you cannot sign a screen out.": "以他人身份工作期间，您不能让某个屏幕退出登录。",
  "While you are working as someone you cannot change the person's alert sound.": "以他人身份工作期间，您不能更改此人的提示音设置。",
  "While you are working as someone you cannot suspend accounts.": "以他人身份工作期间，您不能停用账号。",
  "While you are working as someone you cannot switch accounts back on.": "以他人身份工作期间，您不能重新启用账号。",
  "While you are working as someone you cannot sign people out everywhere.": "以他人身份工作期间，您不能让他人在所有设备上退出登录。",
  "While you are working as someone you cannot change accounts, sessions, roles or rights.": "以他人身份工作期间，您不能更改账号、登录会话、角色或权限。",
  // Starting and ending
  "Only the Developer account can do this.": "只有开发者账号可以执行此操作。",
  "You are already working as someone. Press Stop first.": "您已在以他人身份工作。请先点击“停止”。",
  "You cannot work as a Developer account.": "您不能以开发者账号的身份工作。",
  "That account is switched off, so you cannot work as that person.": "该账号已停用，因此无法以此人身份工作。",
  "A Developer account cannot be changed here.": "不能在此更改开发者账号。",
  // Suspend, switch back on, sign out
  "Type CONFIRM to suspend this account.": "请输入 CONFIRM 以停用此账号。",
  "Type CONFIRM exactly.": "请准确输入 CONFIRM。",
  "You cannot suspend your own account.": "您不能停用自己的账号。",
  "Can't be suspended here: this is the Boss's account.": "无法在此停用：这是老板的账号。",
  "This account is already suspended.": "此账号已被停用。",
  "This account is not suspended.": "此账号未被停用。",
  "You can only switch back on accounts you suspended yourself.": "您只能重新启用由您自己停用的账号。",
  "You cannot sign yourself out here: use Sign out.": "不能在此让自己退出登录：请使用“退出登录”。",
  // ("Can't be suspended here" and "Only the Boss or the MD can switch this account back on" — the notes on the Access list — are translated in developer-access.ts.)
  // The Boss's WhatsApp notice
  "{developer} (Developer) started working as {person} ({role}) at {time}.": "{developer}（开发者）已于 {time} 开始以 {person}（{role}）的身份工作。",
};

export default catalog;
