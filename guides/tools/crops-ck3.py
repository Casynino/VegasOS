# Cuts the pictures of the checking pass (books 02 03 04 05 06 10) out of whole screens:  python3 guides/tools/crops-ck3.py
# Each line: new picture, the picture it is cut from, left, top, right, bottom (pixels of the original).
import json, os, shutil
from PIL import Image

SHOTS = os.path.join(os.path.dirname(__file__), "..", "shots")
CROPS = [
    ("ck3-h-rooms", "ck3-x-rooms", 430, 130, 1760, 745),        # Reception's Rooms page, two rows of tiles (Housekeeping)
    ("ck3-c-sell-pay", "ck3-x-sell", 925, 590, 1536, 2550),     # the right side of Sell: waiter, order, payment (Counter)
    ("ck3-pr-c-form", "pr-c-form", 0, 0, 1536, 2050),           # Purchase requests, the Counter's form (blank rows below it cut away)
    ("ck3-pr-b-form", "pr-b-form", 0, 0, 1536, 2170),           # Purchase requests, the kitchen's form
    ("ck3-g-room-2c", "ck3-g-room-2", 0, 1250, 780, 2440),      # the guest's list of requests, from "Your room" down to "Your requests"
    ("ck3-pr-b-back", "pr-d-chef-open", 170, 320, 1370, 1480),  # the window of a request that was sent back (the screen behind it cut away)
]
for new, src, x0, y0, x1, y1 in CROPS:
    im = Image.open(os.path.join(SHOTS, src + ".jpg")).convert("RGB")
    im.crop((x0, y0, min(x1, im.width), min(y1, im.height))).save(os.path.join(SHOTS, new + ".jpg"), quality=88)
    json.dump({"clip": True}, open(os.path.join(SHOTS, new + ".txt"), "w"))
# the two payment windows were already cut by the picture tool: only a clearer name
for new, src in [("ck3-c-pay-a", "ck3-x-pay"), ("ck3-c-pay-b", "ck3-x-pay-cash")]:
    for ext in (".jpg", ".txt"):
        shutil.copyfile(os.path.join(SHOTS, src + ext), os.path.join(SHOTS, new + ext))
print("done")
