// Customers on the Developer's Access page: search by name or number, suspend (no public booking or ordering) and delete.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  "Customer suspended.": "客户已暂停。",
  "Customer switched back on.": "客户已恢复。",
  "Customer deleted.": "客户已删除。",
  "Search a customer by name or phone number to suspend or delete them.": "按姓名或电话号码搜索客户，以暂停或删除。",
  "Name or phone number": "姓名或电话号码",
  "Search a customer by name or phone number": "按姓名或电话号码搜索客户",
  "No customer found.": "未找到客户。",
  "{name}'s personal details are removed. Stays, orders and payments on record stay in the books.": "{name} 的个人信息将被清除。已有的住宿、订单和付款记录仍保留在账目中。",
  "{name} can no longer book or order through the website or the QR pages. The hotel desk can still serve them.": "{name} 将无法再通过网站或二维码页面预订或点单。酒店前台仍可为其服务。",
  "{name} can book and order through the website and the QR pages again.": "{name} 可以再次通过网站和二维码页面预订和点单。",
  "suspended a customer": "暂停了一位客户",
  "switched a customer back on": "恢复了一位客户",
  "This customer is already suspended.": "该客户已被暂停。",
  "This customer is not suspended.": "该客户未被暂停。",
  "We can't take this online. Please contact the hotel.": "我们无法在线受理此请求，请联系酒店。",
};

export default catalog;
