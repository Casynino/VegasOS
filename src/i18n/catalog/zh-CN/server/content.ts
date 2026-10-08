import type { Catalog } from "../../../translate";

// Server: answers of the content tools — website CMS, media, services, menu, room types, amenities, transport
// services and Settings → Languages (errors, validation and success messages).
const catalog: Catalog = {
  // Website CMS
  "Choose a language.": "请选择语言。",
  "This field cannot be edited.": "此字段不可编辑。",
  "Photos and numbers are the same in every language — change them in English.": "照片和数字在所有语言中通用——请在英文中修改。",
  "This field cannot be empty — use “Reset to default” instead.": "此字段不能为空——请改用“恢复默认”。",
  "Too long (max 2000 characters).": "内容过长（最多 2000 个字符）。",
  "Enter a distance in km.": "请输入以公里为单位的距离。",
  "Add at least one line.": "请至少添加一行。",
  "Choose an active photo from the media library.": "请从媒体库中选择一张启用的照片。",
  "Illustrative (non-hotel) images can only be used on the restaurant and bar sections.": "示意图（非酒店照片）只能用于餐厅和酒吧板块。",
  "Saved — live on the website.": "已保存——网站已更新。",
  "Restored the default text.": "已恢复默认文字。",
  // Media & services
  "Describe the photo (alt text).": "请描述照片内容（替代文字）。",
  "Choose an image.": "请选择一张图片。",
  "Required": "必填",
  "Credit the source of illustrative images.": "请注明示意图的来源。",
  "Rooms, bathrooms, exterior and reception must be real hotel photos.": "客房、浴室、外观和前台必须使用酒店的真实照片。",
  "Real photos only": "仅限真实照片",
  "Photo added to the library.": "照片已添加到媒体库。",
  "Photo updated.": "照片已更新。",
  "Name is required.": "请填写名称。",
  "A service with this name already exists.": "已存在同名服务。",
  "Duplicate": "重复",
  "Service saved.": "服务已保存。",
  // Translations
  "Choose a language other than English.": "请选择英文以外的语言。",
  "Chinese saved.": "中文已保存。",
  "Enter the Chinese name.": "请输入中文名称。",
  "This item no longer exists.": "此项目已不存在。",
  "Chinese is offered to guests.": "已向客人提供中文。",
  "Chinese is no longer offered to guests.": "已停止向客人提供中文。",
  // Menu
  "Choose a category.": "请选择分类。",
  "Give the item a name.": "请为菜品命名。",
  "Whole shillings only.": "只能输入整数先令。",
  "Enter the price.": "请输入价格。",
  "Menu saved.": "菜单已保存。",
  "Give the category a name.": "请为分类命名。",
  "Category saved.": "分类已保存。",
  // Room types & amenities
  "Rate looks too low.": "房价似乎过低。",
  "Invalid path": "路径无效",
  "Admin only": "仅限管理员",
  "Image paths must start with /images/ or https://": "图片路径必须以 /images/ 或 https:// 开头",
  "Room type not found.": "未找到该房型。",
  "Only Admin can change room prices (Settings → Room pricing).": "只有管理员可以修改房价（设置 → 房价）。",
  "Room type saved. New rates apply to new bookings only.": "房型已保存。新房价只适用于新预订。",
  "Amenity not found.": "未找到该设施。",
  // Transport services
  "Price saved.": "价格已保存。",
  "Service not found.": "未找到该服务。",
};
export default catalog;
