# Finance book, checker's pieces: readable parts cut out of long pictures (fa-*), so the words can be read when printed.
# python3 guides/tools/crops-fq.py      — the original pictures are not changed; every piece is a new picture.
# One box = (left, top, right, bottom) of the original, in its own pixels. The notes (.txt) are copied and marked as a cut-out.
import json, os
from PIL import Image

SHOTS = os.path.join(os.path.dirname(__file__), "..", "shots")
CROPS = [
    ("fa-acc-lower", "fa-acc-board2", (435, 614, 1762, 1342)),         # Cash counts and Money movements (Accounts page)
    ("fa-need-exp-c", "fa-need-expenses", (435, 905, 1766, 1440)),     # the waiting expense line, with Approve and Reject
    ("fa-tr-income-c", "fa-tr-income", (398, 795, 1760, 1100)),        # the search and the one line of Income
    ("fa-tr-account-c", "fa-tr-account", (345, 695, 1790, 1200)),      # the same search on the Cash account's page
    ("fa-tr-ledger-c", "fa-tr-ledger", (362, 195, 1790, 870)),         # the search and the ledger line
    ("fa-out-supplier-c", "fa-out-supplier", (435, 150, 1745, 1125)),  # the supplier payment line with Edit and Cancel (without the floating top bar)
]
for new, src, box in CROPS:
    im = Image.open(os.path.join(SHOTS, src + ".jpg")).convert("RGB")
    im.crop(box).save(os.path.join(SHOTS, new + ".jpg"), quality=90)
    notes = json.load(open(os.path.join(SHOTS, src + ".txt")))
    notes["clip"] = True
    json.dump(notes, open(os.path.join(SHOTS, new + ".txt"), "w"))
    print("ok", new)
