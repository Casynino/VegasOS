# Cuts the empty lower part off two purchase-request pictures for the Counter and Kitchen books:  python3 guides/tools/crops-ck.py
# Each line: new picture, the picture it is cut from, left, top, right, bottom (pixels of the original).
import json, os
from PIL import Image

SHOTS = os.path.join(os.path.dirname(__file__), "..", "shots")
CROPS = [
    ("ck-c-sent", "pr-c-sent", 0, 0, 1536, 600),
    ("ck-k-sent", "pr-b-sent", 0, 0, 1536, 760),
]
for new, src, x0, y0, x1, y1 in CROPS:
    im = Image.open(os.path.join(SHOTS, src + ".jpg")).convert("RGB")
    im.crop((x0, y0, min(x1, im.width), min(y1, im.height))).save(os.path.join(SHOTS, new + ".jpg"), quality=88)
    with open(os.path.join(SHOTS, new + ".txt"), "w") as f:
        json.dump({"view": "tablet"}, f)
    print("cut", new)

# The two menu pictures are taken as a box round the menu; a little of the logo line shows at the top. Cut it off (the notes file stays as it is).
for name in ["ck-c-menu", "ck-k-menu"]:
    path = os.path.join(SHOTS, name + ".jpg")
    im = Image.open(path).convert("RGB")
    if im.height > 540:  # not cut yet
        im.crop((0, 36, im.width, im.height)).save(path, quality=90)
        print("trimmed", name)
