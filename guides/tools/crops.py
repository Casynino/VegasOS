# Cuts readable pieces out of the tall full-page pictures:  python3 guides/tools/crops.py
# Each line: new picture, the picture it is cut from, left, top, right, bottom (pixels of the original), frame.
import json, os
from PIL import Image, ImageDraw, ImageFont

SHOTS = os.path.join(os.path.dirname(__file__), "..", "shots")
P = (925, 1750)  # the detail panel of the check-in and check-out pages
TAB = {"view": "tablet"}  # still a whole tablet screen, only shorter
CROPS = [
    ("r-in-2a", "r-in-2", P[0], 300, P[1], 1130),
    ("r-in-2b", "r-in-2", P[0], 1130, P[1], 2490),
    ("r-in-3a", "r-in-3", P[0], 1700, P[1], 2030),
    ("r-in-4a", "r-in-4", P[0], 300, P[1], 900),
    ("r-out-1a", "r-out-1", P[0], 300, P[1], 1085),
    ("r-out-1b", "r-out-1", P[0], 1185, P[1], 2110),
    ("r-out-3a", "r-out-3", P[0], 300, P[1], 1145),
    ("r-out-4a", "r-out-4", P[0], 300, P[1], 1100),
    ("r-out-4b", "r-out-4", P[0], 1505, P[1], 2140),
    ("r-lists-sheet-a", "r-lists-sheet", 425, 570, 1755, 2090),
    ("r-lists-bfast-a", "r-lists-bfast", 355, 475, 1795, 1575),
    ("r-end-6a", "r-end-6", 430, 130, 1765, 1480),
    ("r-end-6b", "r-end-6", 430, 1500, 1765, 2590),
    ("k-gift-c", "k-gift-card", 150, 150, 678, 669),
    ("r-end-2c", "r-end-2", 540, 265, 1200, 1075),
    ("r-new-4c", "r-new-4", 530, 385, 1240, 1075),
    ("r-out-2c", "r-out-2", 570, 935, 1200, 1232),
    ("r-out-5c", "r-out-5", 575, 400, 1195, 740),
    ("r-myshift-a", "r-myshift", 0, 0, 1770, 1300, {"view": "desk"}),
    ("w-reports-a", "w-reports", 0, 150, 780, 1500, {"view": "phone"}),
    ("w-reports-b", "w-reports", 0, 1500, 780, 2468, {"view": "phone"}),
    ("c-sell-2a", "c-sell-2", 930, 560, 1536, 2250),
    # Restaurant Counter (tablet)
    ("c-home-a", "c-home-n", 0, 0, 1536, 1110, TAB),
    ("c-card-a", "c-card-n", 400, 760, 1536, 1450),
    ("c-sell-a", "c-sell-n", 0, 0, 1536, 1390, TAB),
    ("c-tables-a", "c-tables-n", 0, 0, 1536, 1160, TAB),
    ("c-coll-a", "c-coll-n", 0, 0, 1536, 1230, TAB),
    ("c-history-a", "c-history-n", 0, 0, 1536, 880, TAB),
    ("c-resv-a", "c-resv-n", 0, 0, 1536, 1090, TAB),
    ("c-cust-a", "c-cust-n", 0, 0, 1536, 1150, TAB),
    ("c-pay-1a", "c-pay-1", 400, 610, 1536, 1230),
    ("c-pay-2a", "c-pay-2", 410, 430, 1120, 1140),
    ("c-pay-3a", "c-pay-3", 980, 610, 1510, 1230),
    ("c-pay-4a", "c-pay-4", 400, 385, 1536, 705),
    ("c-assign-a", "t-c-assign", 410, 620, 1120, 960),
    ("c-home-c", "c-home", 0, 0, 1536, 1110, TAB),
    # Housekeeping (the printed checklist, cut from inside the white sheet)
    ("h-cover", "h-list", 452, 800, 1732, 1700),
    ("h-top", "h-list", 452, 806, 1732, 1114),
    ("h-part1", "h-list", 452, 1118, 1732, 1692),
    ("h-part2", "h-list", 452, 1684, 1732, 2312),
    ("h-part3", "h-list", 452, 2304, 1732, 2550),
    ("h-part4", "h-list", 452, 3554, 1732, 3664),
    ("h-sign", "h-list", 452, 3680, 1732, 3880),
    ("h-mark", "h-list", 436, 562, 1748, 763),
    ("h-rooms", "r-rooms-n", 420, 128, 1762, 674),
    ("h-print", "r-lists-1", 420, 128, 1762, 756),
    ("h-req", "r-req-1", 420, 128, 1762, 930),
    ("h-ask", "g-room-2", 0, 750, 780, 1688, {"view": "phone"}),
    ("d-transport", "r-trn-1", 420, 128, 1762, 830),
    ("d-assign", "r-trn-3", 430, 0, 1312, 1110),
    # Kitchen (tablet)
    ("k-home-a", "k-home", 0, 0, 1536, 1270, TAB),
    ("k-home-c", "k-home", 0, 0, 1536, 1110, TAB),
    ("k-flow-1a", "k-flow-1", 400, 400, 1536, 930),
    ("k-flow-3a", "k-flow-3", 400, 740, 1536, 1250),
    ("k-card-2a", "k-card-2", 0, 0, 546, 520),
    ("k-card-3a", "k-card-3", 0, 0, 546, 520),
    ("k-inv-a", "k-inv-n", 0, 0, 1536, 1465, TAB),
    ("k-history-a", "k-history-n", 0, 0, 1536, 800, TAB),
    ("k-waste-a", "k-waste-n", 370, 350, 1165, 1240),
    ("k-req-2a", "k-req-2", 420, 150, 1536, 1785),
    ("k-req-3a", "k-req-3", 265, 180, 1280, 1405),
    # Manager book: parts of the long screens
    ("m-home-money", "m2-home-full", 425, 925, 1760, 1545),
    ("m-home-rooms", "m2-home-full", 425, 1555, 1760, 2740),
    ("m-home-rest", "m2-home-full", 425, 2775, 1760, 3385),
    ("m-home-hotel", "m2-home-full", 425, 3875, 1760, 4505),
    ("m-home-staff", "m2-home-full", 425, 4515, 1760, 5095),
    ("m-shifts-sched", "m2-shifts-full", 425, 1465, 1760, 2430),
    ("m-shifts-rota", "m2-shifts-full", 425, 2435, 1760, 3095),
    ("m-shifts-worked", "m2-shifts-full", 425, 3125, 1760, 3430),
    ("m-shift1-top", "m2-shift1", 425, 130, 1760, 1290),
    # Manager: the small windows and short pages, cut out so the words can be read
    ("m4-room-close-c", "m4-room-close", 440, 420, 1325, 1075),
    ("m4-room-move-c", "m4-room-move", 440, 50, 1325, 752),
    ("m4-room-disc-c", "m4-room-disc", 440, 150, 1325, 950),
    ("m4-room-nights-c", "m4-room-nights", 440, 150, 1325, 925),
    ("m4-room-overdue-c", "m4-room-overdue", 440, 440, 1325, 1060),
    ("m4-room-clean-c", "m4-room-clean", 440, 455, 1325, 885),
    ("m4-inv-recv-c", "m4-inv-recv", 465, 150, 1300, 990),
    ("m4-trn-open-c", "m4-trn-open", 440, 45, 1330, 1110),
    ("m4-shift-close-c", "m4-shift-close", 560, 295, 1195, 830),
    ("m2-exp-reject-c", "m2-exp-reject", 535, 375, 1235, 762),
    ("m-accounts-c", "m-accounts", 405, 135, 1765, 675),
    ("m4-daily-c", "m4-daily", 388, 135, 1765, 505),
    ("m4-stockreq-c", "m4-stockreq", 388, 135, 1765, 720),
    ("m4-waste-wait-c", "m4-waste-wait", 400, 135, 1765, 720),
    ("m4-req-open-c", "m4-req-open", 290, 400, 1485, 1100),
    ("m5-waste-done-c", "m5-waste-ok", 400, 135, 1765, 720),
    ("m5-buy-form-c", "m5-buy-form", 285, 395, 1470, 1855),
    ("m5-final-c", "m5-final", 280, 495, 1470, 1760),
    ("m5-final-sure-c", "m5-final-sure", 300, 1540, 1470, 1805),
    ("m5-req-done-c", "m5-req-done", 405, 140, 1765, 890),
    ("m4-trn-prices-c", "m4-trn-prices", 400, 135, 1765, 1140),
    ("m4-waiters-c", "m4-waiters", 400, 135, 1765, 1140),
    ("m4-fin-c", "m4-fin", 400, 135, 1765, 1500),
    ("m4-inv-count-c", "m4-inv-count", 400, 135, 1765, 1140),
    # Guest book: the thank-you note is one very long page — its top and its end
    ("g-thanks-a", "g-thanks", 0, 0, 780, 1560, {"view": "phone"}),
    ("g-thanks-c", "g-thanks", 0, 2700, 780, 4260, {"view": "phone"}),
    ("b-2-a", "b-2", 0, 0, 1770, 1560, {"view": "desk"}),
    ("b-4-a", "b-4", 0, 0, 1770, 1700, {"view": "desk"}),
    # Boss and MD book (English and Chinese twins)
    ("a-cover", "a-md-home", 0, 0, 1770, 1140, {"view": "desk"}),
    ("a-cover-zh", "a-md-home-zh", 0, 0, 1770, 1140, {"view": "desk"}),
    ("a-fin-a", "a-fin", 400, 135, 1765, 1010),
    ("a-fin-a-zh", "a-fin-zh", 400, 135, 1765, 1010),
    ("a-fin-b", "a-fin", 400, 1040, 1765, 2260),
    ("a-fin-b-zh", "a-fin-zh", 400, 1040, 1765, 2260),
    ("a-control-a", "a-control", 400, 135, 1765, 850),
    ("a-control-a-zh", "a-control-zh", 400, 135, 1765, 850),
    ("a-control-b", "a-control", 400, 850, 1765, 1900),
    ("a-control-b-zh", "a-control-zh", 400, 850, 1765, 1900),
    ("a-staffrep-a", "a-staffrep", 400, 135, 1765, 1010),
    ("a-staffrep-a-zh", "a-staffrep-zh", 400, 135, 1765, 1010),
    ("a-staffrep-b", "a-staffrep", 400, 1040, 1765, 1900),
    ("a-staffrep-b-zh", "a-staffrep-zh", 400, 1040, 1765, 1900),
    ("a-daily-3-b", "a-daily-3", 400, 1000, 1765, 1710),
    ("a-daily-3-b-zh", "a-daily-3-zh", 400, 1000, 1765, 1710),
    ("a-daily-3-c", "a-daily-3", 400, 1710, 1765, 2640),
    ("a-daily-3-c-zh", "a-daily-3-zh", 400, 1710, 1765, 2640),
    ("a-daily-3-d", "a-daily-3", 400, 2640, 1765, 3780),
    ("a-daily-3-d-zh", "a-daily-3-zh", 400, 2640, 1765, 3780),
    ("a-shiftrep-a", "a-shiftrep", 400, 135, 1765, 1510),
    ("a-shiftrep-a-zh", "a-shiftrep-zh", 400, 135, 1765, 1510),
    ("a-shiftrep-b", "a-shiftrep", 400, 1540, 1765, 2620),
    ("a-shiftrep-b-zh", "a-shiftrep-zh", 400, 1540, 1765, 2620),
    ("a-shiftrep-c", "a-shiftrep", 400, 2630, 1765, 3900),
    ("a-shiftrep-c-zh", "a-shiftrep-zh", 400, 2630, 1765, 3900),
    ("a-expenses-c", "a-expenses", 400, 135, 1770, 1640),
    ("a-expenses-c-zh", "a-expenses-zh", 400, 135, 1770, 1640),
    ("a-hotelqr-a", "a-hotelqr", 400, 135, 1765, 900),
    ("a-hotelqr-a-zh", "a-hotelqr-zh", 400, 135, 1765, 900),
    ("a-hotelqr-b", "a-hotelqr", 400, 900, 1765, 1470),
    ("a-hotelqr-b-zh", "a-hotelqr-zh", 400, 900, 1765, 1470),
    ("a-accounts-a", "a-accounts", 400, 135, 1765, 675),
    ("a-spin-2-a", "a-spin-2", 400, 135, 1765, 1420),
    ("a-spin-2-b", "a-spin-2", 400, 1440, 1765, 2010),
    ("a-online-c", "a-online", 1150, 235, 1765, 1320),
    ("a-accounts-a-zh", "a-accounts-zh", 400, 135, 1765, 600),
    ("a-spin-2-a-zh", "a-spin-2-zh", 400, 135, 1765, 1300),
    ("a-spin-2-b-zh", "a-spin-2-zh", 400, 1320, 1765, 1880),
    ("a-online-c-zh", "a-online-zh", 1150, 235, 1765, 1135),
]

# Numbers drawn on a cut-out, like the ones the shoot tool draws on a page. Places are pixels of the original picture.
# "top": white rows added above the cut-out (room for numbers over the columns of a printed sheet).
COLS = [495, 602, 770, 961, 1139, 1366, 1486]  # the left edge of each column of the checklist
DRAW = {
    "a-hotelqr-b": {"cover": [(815, 1158, 1385, 1194)]},
    "a-hotelqr-b-zh": {"cover": [(815, 1132, 1385, 1168)]},
    "h-top": {"marks": [(1, 1030, 920), (2, 1424, 845), (3, 497, 978), (4, 736, 978), (5, 975, 978), (6, 1213, 978), (7, 1452, 978), (8, 1170, 1097)]},
    "h-part1": {"top": 48, "marks": [(i + 1, x + 22, 1118 - 24) for i, x in enumerate(COLS)]},
    "h-mark": {"rings": [(744, 675, 896, 722), (912, 675, 1066, 722)], "marks": [(1, 464, 663), (2, 744, 675), (3, 912, 675)]},
}
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

def number(im, n, cx, cy, size=39):
    k, s = 4, size + 14
    tile = Image.new("RGBA", (s * k, s * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    c, r = s * k / 2, size * k / 2
    d.ellipse((c - r - k, c - r, c + r + k, c + r + 3 * k), fill=(0, 0, 0, 46))
    d.ellipse((c - r, c - r, c + r, c + r), fill=(255, 255, 255, 255))
    d.ellipse((c - r + 3 * k, c - r + 3 * k, c + r - 3 * k, c + r - 3 * k), fill=(226, 178, 74, 255))
    d.text((c, c), str(n), font=ImageFont.truetype(FONT, int(size * 0.54 * k)), fill=(23, 19, 10, 255), anchor="mm")
    tile = tile.resize((s, s), Image.LANCZOS)
    im.paste(tile, (round(cx - s / 2), round(cy - s / 2)), tile)

def ring(im, x0, y0, x1, y1, pad=6):
    k = 3
    w, h = x1 - x0 + pad * 2, y1 - y0 + pad * 2
    tile = Image.new("RGBA", (w * k, h * k), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((2 * k, 2 * k, w * k - 2 * k, h * k - 2 * k), radius=15 * k, outline=(200, 150, 46, 255), width=4 * k)
    tile = tile.resize((w, h), Image.LANCZOS)
    im.paste(tile, (x0 - pad, y0 - pad), tile)

for new, src, x0, y0, x1, y1, *rest in CROPS:
    im = Image.open(os.path.join(SHOTS, src + ".jpg")).convert("RGB")
    cut = im.crop((x0, y0, min(x1, im.width), min(y1, im.height)))
    extra = DRAW.get(new)
    if extra:
        top = extra.get("top", 0)
        if top:
            page = Image.new("RGB", (cut.width, cut.height + top), "white")
            page.paste(cut, (0, top))
            cut = page
        for c in extra.get("cover", []):  # hides a line (a practice link) with the colour beside it
            box = (c[0] - x0, c[1] - y0 + top, c[2] - x0, c[3] - y0 + top)
            ImageDraw.Draw(cut).rectangle(box, fill=cut.getpixel((box[0] - 4, box[1] + 4)))
        for r in extra.get("rings", []):
            ring(cut, r[0] - x0, r[1] - y0 + top, r[2] - x0, r[3] - y0 + top)
        for n, x, y in extra.get("marks", []):
            number(cut, n, x - x0, y - y0 + top)
    cut.save(os.path.join(SHOTS, new + ".jpg"), quality=92)
    with open(os.path.join(SHOTS, new + ".txt"), "w") as f:
        json.dump(rest[0] if rest else {"clip": True}, f)
    print(new, x1 - x0, "x", min(y1, im.height) - y0)
