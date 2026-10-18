// The Developer console: what the system records about itself (errors, automatic jobs, provider calls) and what each kind of error means.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // The words for the sort of error and the automatic jobs
  "Validation": "数据校验",
  "Daily report and housekeeping": "每日报告与日常维护",

  // Database
  "The database was slow, busy or could not be reached for a moment.": "数据库刚才响应很慢、很忙，或暂时连不上。",
  "Developer: check the database provider's status (Neon) and the connection limits. A single one is harmless; if it repeats, look at Speed & size.": "开发者：检查数据库服务商（Neon）的状态和连接数限制。偶尔一次无妨；若反复出现，请查看“速度与体量”。",
  "A duplicate was written: the same record was saved twice, usually a double click or two requests at once.": "出现了重复写入：同一条记录被保存了两次，通常是连点两下或同时发出了两个请求。",
  "Developer: nothing if it happens once. If it repeats, the action does not guard against a second press: add a duplicate check.": "开发者：偶尔一次无需处理。若反复出现，说明该操作没有防止重复点击，请加上重复检查。",
  "A record points to something that does not exist (any more).": "某条记录指向了一个不存在（或已被删除）的对象。",
  "Developer: find the action named below. It saves a link to a record that was removed or never made.": "开发者：找到下面列出的操作。它保存了指向已被删除或从未创建的记录的关联。",
  "The record an action wanted to change was already gone or changed by someone else.": "操作想要修改的记录已经不存在，或已被别人修改。",
  "Developer: nothing if it happens once. If it repeats, the action should check the record first and answer with a clear message.": "开发者：偶尔一次无需处理。若反复出现，该操作应先检查记录，并给出清楚的提示。",
  "Two actions changed the same records at the same time and the database stopped one.": "两个操作同时修改了同一批记录，数据库中止了其中一个。",
  "Developer: nothing if it happens once. If it repeats, shorten that action's transaction or let it try again.": "开发者：偶尔一次无需处理。若反复出现，请缩短该操作的事务，或让它自动重试。",
  "Two actions waited for each other and the database stopped one (a deadlock).": "两个操作互相等待，数据库中止了其中一个（死锁）。",
  "Developer: make those actions take their records in the same order.": "开发者：让这些操作按相同的顺序读取和锁定记录。",
  "The database is behind the code: a table the code needs is missing.": "数据库落后于程序：程序需要的某张数据表不存在。",
  "Developer: a migration did not run. Run the migrations on this database (npm run db:deploy) and check the build log.": "开发者：有一次数据库迁移没有执行。请在该数据库上执行迁移（npm run db:deploy），并检查构建日志。",
  "The database is behind the code: a column the code needs is missing.": "数据库落后于程序：程序需要的某个字段不存在。",
  "The database refused an overlap (for example the same room booked twice).": "数据库拒绝了重叠的记录（例如同一间房被重复预订）。",
  "Developer: nothing if the action answered with a clear message. If not, make it check availability first.": "开发者：若该操作已给出清楚的提示，则无需处理；否则请让它先检查房间是否可用。",

  // Validation
  "A value was too long for the field it was saved in.": "某个值太长，超出了所存字段的长度限制。",
  "Developer: limit that field in the form, the same as the database's limit.": "开发者：在表单中按数据库的长度限制来限制该字段。",
  "A required value was missing when a record was saved.": "保存记录时缺少必填的值。",
  "Developer: the action saved a record without a value the database requires. Fix the action named below.": "开发者：该操作保存记录时漏掉了数据库要求的值。请修复下面列出的操作。",
  "A value broke a rule the database keeps (a check).": "某个值违反了数据库的规则（检查约束）。",
  "Developer: the action saved a value the database refuses. Check the value before it is saved.": "开发者：该操作保存了数据库不接受的值。请在保存前先检查该值。",
  "Data in the wrong shape reached the server: a form or a call sent something the code did not expect.": "格式不对的数据到达了服务器：某个表单或调用发来了程序没有预料到的内容。",
  "Developer: the form and the server disagree about the fields. Fix the one that is wrong (see where it happened).": "开发者：表单和服务器对字段的理解不一致。请修正出错的一方（见出错位置）。",
  "The code asked the database for something in the wrong shape.": "程序向数据库发出的请求格式不正确。",
  "Developer: a query or a save has a wrong or missing field. Fix the code at the place listed below.": "开发者：某个查询或保存操作的字段有误或缺失。请修复下面列出位置的代码。",
  "Data in the wrong shape reached the server.": "格式不对的数据到达了服务器。",
  "Developer: the form and the server disagree about a field. Fix the one that is wrong (see where it happened).": "开发者：表单和服务器对某个字段的理解不一致。请修正出错的一方（见出错位置）。",

  // Network
  "A service could not be reached: the connection was refused.": "无法连接到某个服务：连接被拒绝。",
  "Developer: find out which service it was (see where it happened). If it is the database or a provider, check its status page and its keys in the settings.": "开发者：先弄清是哪个服务（见出错位置）。如果是数据库或服务商，请查看其状态页面和设置中的密钥。",
  "A connection was cut in the middle.": "连接在中途被切断。",
  "Developer: nothing if it happens once. If it repeats, check the provider's status.": "开发者：偶尔一次无需处理。若反复出现，请检查服务商的状态。",
  "A service did not answer in time.": "某个服务没有在规定时间内响应。",
  "Developer: nothing if it happens once. If it repeats, check the provider's status and the time limits in the code.": "开发者：偶尔一次无需处理。若反复出现，请检查服务商的状态和程序中的超时设置。",
  "A service's address could not be found.": "找不到某个服务的地址。",
  "Developer: an address in the settings or keys is wrong, or the provider's address changed. System owner: check the keys on the hosting.": "开发者：设置或密钥中的地址有误，或服务商的地址已更改。系统所有者：请检查托管平台上的密钥。",
  "A request was cancelled before it finished.": "一个请求在完成之前被取消了。",
  "Developer: nothing, unless it repeats a lot.": "开发者：无需处理，除非大量重复出现。",
  "A service could not be reached (the database, nTZS, the WhatsApp provider or another).": "无法连接到某个服务（数据库、nTZS、WhatsApp 服务商或其他）。",
  "Developer: find out which service it was (see where it happened) and check its status and the keys in the settings. System owner: check the provider's account and billing.": "开发者：先弄清是哪个服务（见出错位置），并检查其状态和设置中的密钥。系统所有者：请检查服务商的账号和费用。",

  // Permission
  "The server was not allowed to do something (a file or a port).": "服务器无权执行某项操作（文件或端口）。",
  "Developer: the server tried to write where it may not. Use the database or the temporary folder instead.": "开发者：服务器试图写入不允许写入的位置。请改用数据库或临时文件夹。",
  "Something was refused because of rights.": "因权限问题，某项操作被拒绝。",
  "Developer: a page or an action asked for a right the person does not have. Check that the button is hidden for them.": "开发者：某个页面或操作需要此人没有的权限。请确认该按钮对他们是隐藏的。",
  "Something was refused because nobody was signed in.": "因为没有人登录，某项操作被拒绝。",
  "Developer: nothing if it happens once. If it repeats, check the sign-in and session settings.": "开发者：偶尔一次无需处理。若反复出现，请检查登录和会话设置。",
  "Developer: a page or an action asked for something the person may not do. Check the rights of that role and that the button is hidden for them.": "开发者：某个页面或操作要求了此人无权做的事。请检查该角色的权限，并确认按钮对他们是隐藏的。",

  // Code
  "A bug in the code: something was missing or in a shape the code did not expect.": "程序错误：缺少了某项内容，或内容的格式与程序预期不符。",
  "Developer: open the file and line listed below and fix it. This is not a mistake of the person using the system.": "开发者：打开下面列出的文件和行并修复。这不是使用系统的人的错误。",
  "A bug in the code, or text that could not be read (for example broken data from outside).": "程序错误，或无法读取的文本（例如来自外部的损坏数据）。",
  "The database driver crashed.": "数据库驱动程序崩溃了。",
  "Developer: restart by redeploying. If it repeats, update the database driver.": "开发者：重新部署以重启。若反复出现，请升级数据库驱动。",
  "The database could not be reached or opened.": "无法连接或打开数据库。",
  "Developer: check the database address in the settings and the database provider's status (Neon).": "开发者：检查设置中的数据库地址和数据库服务商（Neon）的状态。",

  // Unknown
  "A browser had an old page open while the system was updated and asked for something that no longer exists.": "系统更新时，某个浏览器还开着旧页面，并请求了已经不存在的内容。",
  "Developer: nothing, it clears when the page is reloaded. If it keeps coming long after an update, check the last release.": "开发者：无需处理，刷新页面后即消失。若更新很久之后仍不断出现，请检查最近一次发布。",
  "An error the system does not recognise.": "系统无法识别的错误。",
  "Developer: open the place it happened and the lines listed below. If it is only seen once, watch whether it comes back.": "开发者：打开出错的位置和下面列出的代码行。如果只出现一次，先观察它是否再次出现。",
};

export default catalog;
