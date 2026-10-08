import type { SiteContent } from "./content";

/**
 * PUBLIC SITE CONTENT IN CHINESE — the default Chinese for the website copy in content.ts (same structure, only the
 * text). Same facts as the English, nothing added. Image paths are shared by both languages; their alt texts are in
 * ALT_ZH below (keyed by the English alt, so a photo keeps its Chinese description wherever it is used).
 *
 * getSiteContent() shows, for a Chinese visitor: the Chinese saved by staff in Staff → Website → else this default,
 * but only while the English field is unchanged (an English edit shows in English until it is translated) → else the
 * English. Placeholders ({hotelName} {airportKm} …) stay exactly as in the English.
 */

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export const CONTENT_ZH: DeepPartial<SiteContent> = {
  facts: {
    airportName: "朱利叶斯·尼雷尔国际机场 (DAR)",
    airportShort: "JNIA",
    locationLine: "Mlimani City · 达累斯萨拉姆",
  },

  services: [
    { name: "免费 Wi-Fi", description: "每间客房均提供免费 Wi-Fi。" },
    { name: "含早餐", description: "入住期间每天早晨均含早餐，每间客房皆享。" },
    { name: "餐厅", description: "从早餐到晚餐，就在酒店之内。" },
    { name: "酒吧", description: "一天结束时放松身心的惬意之所。" },
    { name: "客房送餐", description: "餐食和饮品送至您的房间。" },
    { name: "24 小时前台", description: "无论深夜抵达还是清晨离店，前台始终有人为您服务。" },
    { name: "客房清洁", description: "入住期间，客房始终整洁清新。" },
    { name: "免费停车场", description: "酒店内设私人停车场，住客免费使用。" },
    { name: "机场接送", description: "由酒店专属司机接机——距 JNIA 约 {airportKm} 公里。" },
    { name: "会议室", description: "私密会议室，适用于会议和研讨会。" },
  ],

  seo: {
    homeTitle: "Vegas Luxury Hotel — 达累斯萨拉姆 Mlimani City | 官网直订",
    homeDescription:
      "酒店位于达累斯萨拉姆 Mlimani City 环岛、Mwenge Tower 后方。客房含免费 Wi-Fi 和早餐，设有餐厅、酒吧、会议室，并提供机场接送。官网在线直订，到店付款。",
  },

  home: {
    hero: {
      title: "您的旅居，",
      titleAccent: "更显非凡。",
      intro: "精致客房、每日早餐，在 Mlimani City 迎接您的温暖款待——距 Mwenge 仅数分钟。",
      primaryCta: { label: "查询空房" },
      secondaryCta: { label: "浏览客房" },
      slides: [
        { caption: "客房与套房" },
        { caption: "酒店床品" },
        { caption: "酒店外观" },
        { caption: "客房一隅" },
        { caption: "套房浴室" },
      ],
      highlights: ["免费早餐", "免费 Wi-Fi", "餐厅与酒吧", "会议室"],
      chips: [
        { text: "每次入住均含早餐" },
        { text: "每间客房免费 Wi-Fi" },
        { text: "酒店司机机场接机" },
      ],
    },
    intro: {
      kicker: "欢迎来到 Vegas",
      title: "在这里放慢脚步，舒适入住，",
      titleAccent: "以不同的视角感受达累斯萨拉姆。",
      paragraphs: [
        "每间客房均配有空调、独立卫浴、平板电视、办公桌和茶和咖啡设施——安静、整洁，入住即可享用。",
        "套房空间更为宽敞，许多浴室还配有按摩浴缸，让漫长的一天在惬意中结束。",
      ],
    },
    stay: {
      kicker: "Vegas 体验",
      title: "美好旅居所需的一切，",
      titleAccent: "尽在一处。",
      items: [
        { title: "入住", body: "安静的空调客房，配独立卫浴——许多还配有按摩浴缸。" },
        { title: "餐饮", body: "从早餐到晚餐尽在本店餐厅，一天结束后再到酒吧小酌一杯。" },
        { title: "联络", body: "每间客房免费 Wi-Fi，配有办公桌，前台 24 小时服务。" },
        { title: "聚会", body: "私密会议室，适用于会议、研讨会和聚会。" },
      ],
    },
    rooms: {
      kicker: "客房与套房",
      title: "安然休憩，处处用心",
      intro: "所有房型均含免费 Wi-Fi 和早餐。",
    },
    experience: {
      kicker: "客人选择 Vegas 的理由",
      title: "贴心之选，均已包含",
      intro: "退房时没有意外：以下服务均含在房费之内。在线预订，几秒钟即可用手机支付付款。",
      features: [
        { title: "含早餐", body: "入住期间每天早晨均含早餐，每间客房皆享。" },
        { title: "免费 Wi-Fi", body: "每间客房畅享网络——工作、追剧或与家人通话都方便。" },
        { title: "客房送餐", body: "想留在房间时，餐食和饮品会送到您房中。" },
        { title: "免费停车场", body: "酒店内设私人停车场，住客免费使用。" },
        { title: "24 小时前台", body: "无论深夜抵达还是清晨离店，前台始终有人为您服务。" },
        { title: "手机支付", body: "无需银行卡——M-Pesa、Airtel Money、Mixx by Yas 或 HaloPesa，手机直接付款。" },
      ],
    },
    services: {
      kicker: "服务",
      title: "所需一切，近在咫尺",
      intro: "{hotelName} 为每位客人提供的确定服务。",
    },
    restaurant: {
      kicker: "餐厅",
      title: "从早餐",
      titleAccent: "到鸡尾酒时光",
      body: "本店餐厅从早餐一直营业到晚餐，菜单从非洲风味延伸到披萨、寿司和烧烤。",
      menuKicker: "菜单精选",
      cta: { label: "探索餐厅" },
    },
    bar: {
      kicker: "酒吧",
      title: "小酌一杯",
      titleAccent: "为一天画上句点",
      body: "会见同事、与朋友叙旧，或在晚餐前稍作休憩的惬意之所。入住期间欢迎随时光临。",
      cta: { label: "前往酒吧" },
    },
    meeting: {
      kicker: "会议与办公",
      title: "会议室",
      body: "私密会议室，适用于会议和研讨会，酒店内即有餐厅。告诉我们日期和人数，其余交给我们。",
      events: ["商务会议", "研讨会", "私人聚会"],
      primaryCta: { label: "查询空档并预订" },
      secondaryCta: { label: "了解更多" },
    },
    arrival: {
      kicker: "抵达",
      title: "我们在机场迎接您",
      body: "{hotelName} 距朱利叶斯·尼雷尔国际机场约 {airportKm} 公里。酒店专属司机可前往接机——预订时申请接机并填写航班信息，我们会通过电话或 WhatsApp 与您确认。",
      steps: [
        { title: "预订时申请", body: "勾选“接机”，并填写航班号和抵达时间。" },
        { title: "我们确认", body: "我们的团队会通过电话或 WhatsApp 确认您的接机安排。" },
        { title: "与司机会合", body: "酒店司机在您抵达时迎接，直接送您到酒店。" },
      ],
      cta: { label: "预订并申请接机" },
    },
    gallery: {
      kicker: "相册",
      title: "一览酒店",
    },
    location: {
      kicker: "位置",
      title: "位于 Mlimani City 环岛，Mwenge Tower 后方",
      points: [
        { title: "距机场约 {airportKm} 公里", body: "朱利叶斯·尼雷尔国际机场——酒店提供机场接送。" },
        { title: "Mlimani City 与 Mwenge", body: "紧邻 Mlimani City 环岛，位于 Mwenge Tower 后方。" },
      ],
    },
    cta: {
      kicker: "官网直订",
      title: "您的房间",
      titleAccent: "已为您备好。",
      body: "选择日期并提交申请——我们的团队会与您确认，抵达时再付款。",
    },
  },

  pages: {
    rooms: {
      kicker: "客房与套房",
      title: "找到最适合您的房间",
      intro: "从适合独行旅客的精致单人间，到宽敞的行政套房。",
      includedTitle: "无论选择哪种房型，均包含",
      includedNote: "{checkIn} 起可办理入住，{checkOut} 前办理退房。",
      helpTitle: "不确定哪种房间适合您？",
      helpBody: "搜索您的日期查看空房——或告诉我们您的行程，前台会为您推荐最合适的房型。",
    },
    hotel: {
      kicker: "酒店",
      title: "Mwenge 的舒适、格调与卓越",
      intro: "{hotelName} 位于 {city} {address}——商务与休闲出行的便利精致之选。",
      aboutKicker: "关于我们",
      aboutTitle: "所需一应俱全，没有多余",
      about: [
        "酒店共有 {roomTypes} 种房型、{rooms} 间客房，均配有空调、独立卫浴、电视、办公桌、茶和咖啡设施，并含免费 Wi-Fi 和免费早餐。",
        "酒店还设有餐厅和酒吧、私密会议室以及 24 小时前台。我们提供客房送餐、客房清洁、免费停车，以及由酒店专属司机提供的机场接送——朱利叶斯·尼雷尔国际机场距此约 {airportKm} 公里。",
      ],
      servicesTitle: "竭诚为您服务",
    },
    gallery: {
      kicker: "相册",
      title: "走进 Vegas Luxury Hotel",
      intro: "客房、配有按摩浴缸的套房、前台、会议室以及酒店建筑本身——这里的每一张照片都拍摄于本酒店。",
    },
    restaurant: {
      kicker: "餐厅",
      title: "一天中的每一刻，都有您的座位",
      intro: "从清晨的第一杯咖啡，到鸡尾酒时光和晚餐，汇集非洲各地及世界各国的美食。",
      cuisinesTitle: "环游世界的菜单",
      cuisinesBody: "非洲风味与美式、中式、西班牙菜肴并列，还有披萨、寿司和烧烤。",
      mealsTitle: "从早到晚",
      breakfastNote: "住店客人每间客房预订均含早餐。",
      closingTitle: "计划用餐、庆祝或工作午餐？",
      closingBody: "联系我们，我们的团队乐意为您安排。",
      cuisines: ["非洲菜", "美式", "中餐", "披萨", "西班牙菜", "寿司", "烧烤"],
      meals: ["早餐", "早午餐", "午餐", "下午茶", "鸡尾酒时光", "晚餐"],
      dietary: ["素食", "纯素", "无麸质", "无乳制品"],
    },
    bar: {
      kicker: "酒吧",
      title: "放慢脚步，一天已经结束",
      intro: "本店酒吧是结束一天的惬意之所——会见同事、与朋友叙旧，或在晚餐前静静小坐。",
      points: [
        { title: "就在酒店内", body: "酒吧就在酒店之内——漫长一天后无需再打车。" },
        { title: "鸡尾酒时光", body: "本店餐厅也设有鸡尾酒时光，傍晚可以自然过渡到晚餐。" },
        { title: "留宿一晚", body: "楼上客房含免费早餐和 Wi-Fi，再来一杯也无妨，就此住下。" },
      ],
      closingTitle: "期待您的光临",
    },
    meeting: {
      kicker: "会议与办公",
      fallbackName: "会议室",
      fallbackDescription: "私密会议室，适用于会议和研讨会。",
      whyTitle: "实用便利，近在咫尺",
      why: [
        { title: "交通便利", body: "位于 Mlimani City 环岛，Mwenge Tower 后方。" },
        { title: "免费停车", body: "酒店内设免费私人停车场。" },
        { title: "店内设有餐厅", body: "早餐、午餐、下午茶和晚餐，尽在一处。" },
        { title: "机场接送", body: "乘机抵达的客人可由酒店专属司机接机。" },
      ],
      stepsTitle: "简单三步",
      steps: [
        { title: "告诉我们您的计划", body: "发送您希望的日期、时间和人数。" },
        { title: "我们确认", body: "我们的团队会与您确认空档及细节。" },
        { title: "开会", body: "抵达 {hotelName}——会议室已为您准备就绪。" },
      ],
    },
    contact: {
      kicker: "联系我们",
      title: "日夜都在，随时为您服务",
      intro: "前台 24 小时营业。欢迎致电、发送 WhatsApp 或留言——我们会尽快回复您。",
      formTitle: "给我们留言",
      formIntro: "预订、会议室咨询、机场接送或其他任何事宜。",
    },
    book: {
      intro: "选择日期和人数，查看实时空房和价格。现在用手机支付付款即可保留房间，也可以稍后付款。",
      pausedIntro: "在线预订目前暂停。前台很乐意直接为您预订房间。",
    },
    footer: {
      blurb: "精致客房、餐厅与酒吧，在达累斯萨拉姆 Mlimani City 迎接您的温暖款待。",
    },
  },
};

/** Photo descriptions (alt text) in Chinese, keyed by the English alt. Unknown alts stay in English. */
export const ALT_ZH: Record<string, string> = {
  // Hotel photo library
  "Exterior of the Vegas Luxury Hotel building": "Vegas Luxury Hotel 建筑外观",
  "Street entrance of Vegas Luxury Hotel with its gold arch gate": "Vegas Luxury Hotel 临街入口及金色拱门",
  "Reception desk with the Vegas Luxury Hotel crest": "带有 Vegas Luxury Hotel 徽标的前台",
  "Reception and lobby at Vegas Luxury Hotel": "Vegas Luxury Hotel 前台与大堂",
  "Reception desk and world clocks in the lobby": "大堂前台与世界时钟",
  "Bathrobe provided for guests in the room": "客房内为客人准备的浴袍",
  "Seating area and en-suite door in a guest room": "客房休息区与浴室门",
  "Work desk, TV and air conditioning in a guest room": "客房内的办公桌、电视和空调",
  "Tea and coffee tray by the window in a suite": "套房窗边的茶和咖啡托盘",
  "Lounge sofa in an Executive Suite": "行政套房内的休闲沙发",
  "The yellow façade and entrance gate of Vegas Luxury Hotel": "Vegas Luxury Hotel 的黄色外立面与入口大门",
  "Balconies of Vegas Luxury Hotel against a blue sky": "蓝天映衬下的 Vegas Luxury Hotel 阳台",
  "Guest room with a king bed, red runner, sofa and a floor-to-ceiling window": "配有特大床、红色床旗、沙发和落地窗的客房",
  "Bed dressed with Vegas Luxury Hotel cushions and a red runner": "铺有 Vegas Luxury Hotel 靠垫和红色床旗的床",
  "The bed reflected in the room's oval mirror": "客房椭圆镜中映出的床",
  "Sofa, oval mirror and a hotel bathrobe": "沙发、椭圆镜与酒店浴袍",
  "Desk, kettle, mini fridge and room phone": "书桌、电水壶、迷你冰箱和客房电话",
  "Lounge sofa beside a tall oval mirror": "高大椭圆镜旁的休闲沙发",
  "Washbasin with a round black mirror": "配圆形黑框镜的洗手台",
  "Wave-tiled bathroom with fresh towels": "波浪纹瓷砖浴室与干净毛巾",
  "Bathroom with a bathtub and shower": "配有浴缸和淋浴的浴室",
  "Vegas Luxury Hotel meeting room with a U-shaped boardroom table": "Vegas Luxury Hotel 会议室，配 U 形会议桌",
  "En-suite bathroom with a jetted jacuzzi bathtub": "配有按摩浴缸的独立浴室",
  "Private en-suite bathroom with walk-in shower": "配步入式淋浴的独立浴室",
  "Suite bedroom with red Vegas Luxury Hotel cushions and throw": "套房卧室，配红色 Vegas Luxury Hotel 靠垫和床毯",
  "Guest bedroom with blue Vegas Luxury Hotel cushions and throw": "客房卧室，配蓝色 Vegas Luxury Hotel 靠垫和床毯",
  "Vegas Luxury Hotel": "Vegas Luxury Hotel",
  // Site copy photos
  "Guest room at Vegas Luxury Hotel": "Vegas Luxury Hotel 客房",
  "Guest room at Vegas Luxury Hotel with red and gold hotel linens": "Vegas Luxury Hotel 客房，配红金色酒店床品",
  "Guest room with red and gold Vegas Luxury Hotel linens and tall windows": "配红金色 Vegas Luxury Hotel 床品和高窗的客房",
  "The Vegas Luxury Hotel building at Mlimani City": "位于 Mlimani City 的 Vegas Luxury Hotel 建筑",
  "Sofa, oval mirror and a hotel bathrobe in a guest room": "客房内的沙发、椭圆镜与酒店浴袍",
  "Jacuzzi bathtub fittings in a suite bathroom": "套房浴室中的按摩浴缸",
  "Executive Suite bedroom with red and gold Vegas linens": "行政套房卧室，配红金色 Vegas 床品",
  "Suite bedroom at Vegas Luxury Hotel": "Vegas Luxury Hotel 套房卧室",
  "Vegas Luxury Hotel building exterior": "Vegas Luxury Hotel 建筑外观",
  "Reception at Vegas Luxury Hotel": "Vegas Luxury Hotel 前台",
  // Illustrative photography (not the hotel)
  "Warmly lit restaurant with set tables (illustrative)": "灯光温馨、餐桌已摆好的餐厅（示意图）",
  "Evening dining room with soft lighting (illustrative)": "柔和灯光下的夜间餐厅（示意图）",
  "Table for two above city lights at night (illustrative)": "俯瞰城市夜景的双人餐桌（示意图）",
  "Bar counter with stools and shelves of bottles (illustrative)": "配高脚凳和酒架的吧台（示意图）",
  "Bartender pouring a drink (illustrative)": "调酒师正在倒酒（示意图）",
  "A martini on the bar (illustrative)": "吧台上的一杯马提尼（示意图）",
  "Modern meeting room with a long table (illustrative)": "配长桌的现代会议室（示意图）",
  "Boardroom table with leather chairs by tall windows (illustrative)": "高窗旁配皮椅的会议桌（示意图）",
  "Long meeting table with a screen at the end (illustrative)": "尽头设有屏幕的长会议桌（示意图）",
  "Wooden meeting table with a city view (illustrative)": "可眺望城市景观的木质会议桌（示意图）",
  "Small meeting room with a wall screen (illustrative)": "配壁挂屏幕的小型会议室（示意图）",
  "Office chairs lined up at a conference table (illustrative)": "会议桌旁整齐排列的办公椅（示意图）",
  "Aerial view of Dar es Salaam (illustrative)": "达累斯萨拉姆鸟瞰（示意图）",
  "Aerial view of the Dar es Salaam coastline (illustrative)": "达累斯萨拉姆海岸线鸟瞰（示意图）",
  "Dar es Salaam skyline by the harbour (illustrative)": "海港边的达累斯萨拉姆天际线（示意图）",
};

/** A photo's alt text in Chinese when known, else as it is. */
export const altZh = (alt: string) => ALT_ZH[alt] ?? alt;

/** Lays a translation over the English: objects field by field, lists of objects item by item, a list of words whole. */
export function overlay(base: unknown, over: unknown): unknown {
  if (over === undefined || over === null) return base;
  if (Array.isArray(over)) {
    if (!Array.isArray(base) || over.every((x) => typeof x !== "object")) return over;
    return base.map((b, i) => (i < over.length ? overlay(b, over[i]) : b));
  }
  if (typeof over === "object") {
    if (!base || typeof base !== "object") return over;
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over)) out[k] = overlay(out[k], v);
    return out;
  }
  return over;
}
