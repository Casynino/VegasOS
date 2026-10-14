# Finance book, second half: readable pieces cut out of the tall purchase-request pictures (pr-*), so the words can be read when printed.
# python3 guides/tools/crops-fb.py      — the pr-* pictures are not changed; every piece is a new picture "fb-c-*".
# A piece is one box (left, top, right, bottom of the original) or several boxes put one under the other (a dark gap between them).
import json, os
from PIL import Image, ImageDraw

SHOTS = os.path.join(os.path.dirname(__file__), "..", "shots")
CROPS = [
    ("fb-c-board", "pr-f-board", [(420, 100, 1770, 1010)]),
    ("fb-c-queue", "fb-x-queue", [(430, 130, 1770, 400), (430, 775, 1770, 1130)]),
    ("fb-c-open1", "pr-d-open1", [(270, 500, 1500, 1620)]),
    ("fb-c-back", "pr-d-back-form", [(270, 480, 1500, 1620)]),
    ("fb-c-fopen", "pr-f-open", [(420, 175, 1770, 470), (420, 1430, 1770, 1690)]),
    ("fb-c-authform", "pr-f-authform", [(480, 1040, 1280, 1500)]),
    ("fb-c-limit", "pr-f-limit", [(520, 10, 1240, 200), (500, 750, 1260, 1200)]),
    ("fb-c-authorized", "pr-f-authorized", [(420, 185, 1770, 300), (420, 1440, 1770, 1600)]),
    ("fb-c-invopen", "pr-h-open", [(420, 1380, 1770, 1660)]),
    ("fb-c-verifyform", "pr-h-verify-form", [(480, 1040, 1280, 1500)]),
    ("fb-c-verified", "pr-h-verified", [(420, 1320, 1770, 1630)]),
    ("fb-c-payform", "pr-h-pay-form", [(480, 870, 1280, 1680)]),
    ("fb-c-paid", "pr-h-paid", [(420, 150, 1770, 520), (420, 2230, 1770, 2500)]),
    ("fb-c-dispform", "pr-h-dispute-form", [(480, 880, 1280, 1350)]),
    ("fb-c-disputed", "pr-h-disputed", [(420, 1080, 1770, 1560)]),
    ("fb-c-expenses", "pr-h-expenses", [(400, 380, 1770, 690), (400, 1270, 1770, 1420)]),
    ("fb-c-home", "pr-h-home", [(395, 400, 1770, 590), (395, 770, 1770, 1230)]),
    ("fb-c-invoices", "pr-h-invoices", [(400, 395, 1770, 1010)]),
]
GAP = 16
for new, src, boxes in CROPS:
    im = Image.open(os.path.join(SHOTS, src + ".jpg")).convert("RGB")
    cuts = [im.crop((x0, y0, min(x1, im.width), min(y1, im.height))) for x0, y0, x1, y1 in boxes]
    if len(cuts) == 1:
        out = cuts[0]
    else:
        bg = cuts[0].getpixel((cuts[0].width - 3, 3))
        w = max(c.width for c in cuts)
        h = sum(c.height for c in cuts) + GAP * (len(cuts) - 1)
        out = Image.new("RGB", (w, h), bg)
        y = 0
        d = ImageDraw.Draw(out)
        for i, c in enumerate(cuts):
            out.paste(c, (0, y))
            y += c.height
            if i < len(cuts) - 1:
                d.ellipse((w // 2 - 18, y + 6, w // 2 - 12, y + 12), fill=(110, 110, 110))
                d.ellipse((w // 2 - 3, y + 6, w // 2 + 3, y + 12), fill=(110, 110, 110))
                d.ellipse((w // 2 + 12, y + 6, w // 2 + 18, y + 12), fill=(110, 110, 110))
                y += GAP
    out.save(os.path.join(SHOTS, new + ".jpg"), quality=92)
    with open(os.path.join(SHOTS, new + ".txt"), "w") as f:
        json.dump({"clip": True}, f)
    print(new, out.width, "x", out.height)
