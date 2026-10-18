// Developer Home as one page: the checks, hints and notes that now point to a part of the page ("Errors & jobs", "Messages & reports", "Problems")
// instead of a tab, plus the wording after the review (refused signatures apart, checks that do not apply, one cause shown once).
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "Open the Errors & jobs part to see them.": "请打开“错误与自动任务”部分查看。",
  "A few typing mistakes are normal. Many in a day can mean someone is guessing passwords. The details are in the Errors & jobs part.": "偶尔输错是正常的。一天内大量失败可能意味着有人在猜密码。详情见“错误与自动任务”部分。",
  "These lines are in the built code: the hosting does not keep the original file names. The message and the place named above tell where to look.": "这些行位于编译后的代码中：托管服务不保留原始文件名。请根据上方的错误信息和位置查找。",
  "Unexpected errors the server caught in the last 30 days, one line for each different error. A repeat adds to its count. Emails, numbers, keys, links' addresses and request contents are taken out before an error is kept.": "服务器在最近 30 天内捕获的意外错误，每种不同的错误占一行。重复出现只会增加次数。保存错误前，邮箱、数字、密钥、链接地址和请求内容都会被去掉。",
  "Refused (bad signature), 7 days": "被拒绝（签名错误），7 天",
  "A duplicate was refused: the database would not save the same record twice, usually a double click or two requests at once.": "重复内容被拒绝：数据库不允许把同一条记录保存两次，通常是连点两下或同时发出了两个请求。",
  "A service's address could not be looked up right now.": "暂时无法解析某个服务的地址。",
  "Developer: nothing if it happens once. If it repeats, check the provider's status and the network of the hosting.": "开发者：偶尔一次无需处理。如果反复出现，请检查服务商的状态和托管服务的网络。",
  "A service could not be reached: there was no route to it.": "无法连接某个服务：没有可用的网络路径。",
  "Check that the nTZS key is set and valid, that the scheduled jobs run (the Errors & jobs part) and that the nTZS webhook arrives. Only when the system works again does Finance settle the payment itself.": "请检查 nTZS 密钥是否已设置且有效、定时任务是否在运行（见“错误与自动任务”部分），以及 nTZS 的回调是否到达。系统恢复正常后，才由财务自己处理这笔付款。",
  "Open Errors & jobs": "打开“错误与自动任务”",
  "A withdrawal was sent to nTZS and is still not finished long after it should be (2 hours for a phone or a Lipa number, four days for a bank). Either nTZS is not answering, or the system is not asking it.": "一笔提现已发送给 nTZS，但远超应有时间仍未完成（手机或 Lipa 号码为 2 小时，银行为四天）。要么 nTZS 没有回应，要么系统没有去询问。",
  "Check the nTZS key, the scheduled jobs (the Errors & jobs part) and the nTZS dashboard for the withdrawal. After the cause is fixed, the Boss or Finance settles the withdrawal itself.": "请检查 nTZS 密钥、定时任务（见“错误与自动任务”部分）以及 nTZS 后台中的这笔提现。原因解决后，由老板或财务自己处理这笔提现。",
  "Open the Errors & jobs part: did the daily job run, and did it fail? Check the cron secret and the server logs for the \"booking states\" step.": "请打开“错误与自动任务”部分：每日任务是否运行过，是否失败？检查定时任务密钥，并在服务器日志中查看“预订状态”这一步。",
  "Check that the cron secret is set, that the jobs are listed under Cron Jobs in Vercel and that the last deploy kept vercel.json. The Errors & jobs part shows the last run of each job.": "请检查定时任务密钥是否已设置，任务是否列在 Vercel 的 Cron Jobs 中，以及最近一次部署是否保留了 vercel.json。“错误与自动任务”部分会显示每个任务的最近一次运行。",
  "Open the Errors & jobs part for the job's last error, find the cause in the code or the logs, and deploy the fix.": "请打开“错误与自动任务”部分查看该任务的最近一次错误，在代码或日志中找到原因，然后部署修复。",
  "Check that the webhook secret on the server is the one in the nTZS dashboard, and that nTZS calls this site's address. The Errors & jobs part shows the last failure.": "请检查服务器上的回调密钥是否与 nTZS 后台中的一致，以及 nTZS 调用的是本站地址。“错误与自动任务”部分会显示最近一次失败。",
  "Check the WhatsApp (CallMeBot) keys on the server and the provider's limits. The Messages & reports part shows the kind of trouble for each failed message. When it works again, the Boss, the MD or a manager can send the reports again.": "请检查服务器上的 WhatsApp（CallMeBot）密钥和服务商的限制。“消息与报告”部分会显示每条失败消息的问题类型。恢复正常后，老板、总经理或经理可以重新发送报告。",
  "The last closed day's daily report reached the Boss, or is not due yet.": "最近一个已结账日的日报已送达老板，或还没到发送时间。",
  "The last closed day's room report reached the Boss, or is not due yet.": "最近一个已结账日的客房报告已送达老板，或还没到发送时间。",
  "Find why: did the job run (the Errors & jobs part), and does WhatsApp work (the key and the recipients)? The Developer cannot make or send financial reports: the Boss, the MD or a manager sends it again from Reports once the cause is fixed.": "查明原因：任务是否运行过（见“错误与自动任务”部分），WhatsApp 是否正常（密钥和收件人）？开发者不能生成或发送财务报告：原因解决后，由老板、总经理或经理在“报告”中重新发送。",
  "Not checked here: this report is switched off or nobody is set to receive it.": "此处未检查：该报告已关闭，或没有设置收件人。",
  "Open the Errors & jobs part: each error is grouped with how often and when, what kind it is and where in the code. Fix the cause and deploy.": "请打开“错误与自动任务”部分：每个错误都按出现次数、时间、类型和代码位置归类。修复原因后部署。",
  "Links in WhatsApp messages (a guest's stay link, a payment link, a report link) are built from the site's address. Without it a link made by a scheduled job carries the hosting's own address (…vercel.app) instead of the hotel's website.": "WhatsApp 消息中的链接（住客入住链接、付款链接、报告链接）由网站地址生成。没有设置时，定时任务生成的链接会带上托管服务自己的地址（…vercel.app），而不是酒店网站的地址。",
  "The live site has no address set, so links made by scheduled jobs carry the hosting's own address.": "正式网站没有设置地址，所以定时任务生成的链接会带上托管服务自己的地址。",
  "Not checked here: reports are switched off.": "此处未检查：报告已关闭。",
  "Not checked here: reports are switched off or nobody is set to receive them.": "此处未检查：报告已关闭，或没有设置收件人。",
  "Open the Errors & jobs part to see which accounts were tried and how often. If one account is tried again and again, tell the Boss or the MD.": "请打开“错误与自动任务”部分，查看哪些账号被尝试过以及次数。如果同一个账号被反复尝试，请告诉老板或总经理。",
  "See the list in the Errors & jobs part: it shows what was refused and which right it needed. Nothing is broken unless the same thing is tried again and again.": "请查看“错误与自动任务”部分的列表：其中显示了被拒绝的内容和所需权限。除非同一件事被反复尝试，否则没有任何故障。",
  "Not counted again: it follows from a problem above.": "不再重复计算：它源于上面的某个问题。",
  "Open the Problems part to see which checks and why. If it stays like that, find out what stops the check.": "请打开“问题”部分，查看是哪些检查以及原因。如果一直如此，请找出是什么阻止了检查。",
  "A few typing mistakes are normal. Many in a day can mean someone is guessing passwords. The table in the Errors & jobs part shows which accounts were tried and how often.": "偶尔输错是正常的。一天内大量失败可能意味着有人在猜密码。“错误与自动任务”部分的表格显示了哪些账号被尝试过以及次数。",
  "If one account is tried again and again, tell the Boss or the MD.": "如果同一个账号被反复尝试，请告诉老板或总经理。",
  "See the list in the Errors & jobs part. Nothing is broken.": "请查看“错误与自动任务”部分的列表。没有任何故障。",
};

export default catalog;
