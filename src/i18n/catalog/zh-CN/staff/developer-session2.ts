// Developer account, session fixes (round 2): the Developer's own password rule, switching accounts on / off only from Access, the Boss is never
// signed out from Access, and the Users page words that changed because of it.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // The Developer's own password rule (src/lib/developer-password.ts) — the same rule as the setup command's
  "The Developer password needs at least 14 characters, with a capital letter, a small letter, a number and a symbol. It must not be your email, contain the first part of it, or contain an easy word like 'password'.":
    "开发者密码至少需要 14 个字符，并包含大写字母、小写字母、数字和符号。不能与您的邮箱相同，不能包含邮箱的前半部分，也不能包含“password”之类的简单词语。",
  // Access: the Boss is never signed out from here
  "Can't sign the Boss out here": "无法在此让老板退出登录",
};
export default catalog;
