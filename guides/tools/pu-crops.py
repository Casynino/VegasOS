"""Makes the cut-out pictures of the Purchasing book (prefix pu-c-) from whole-page pictures (pr-... and pu-...).
Run: python3 guides/tools/pu-crops.py [new-id ...]   (from the project folder; it only writes new files in guides/shots).
A cut-out keeps the numbers that were drawn on the whole picture."""
import json,sys
from PIL import Image
import os
S=os.path.join(os.getcwd(),"guides","shots")+"/"
# (source, new id, box)
C=[
 ("pr-e-menu","pu-c-menu",(0,0,1770,345)),
 ("pr-e-board","pu-c-board",(380,120,1770,880)),
 ("pr-d-open1","pu-c-fin-approve",(285,520,1480,1590)),
 ("pr-d-asha-open","pu-c-asker-open",(290,430,1480,1375)),
 ("pu-q-doc","pu-c-q-doc",(340,395,1410,1345)),
 ("pu-quotes","pu-c-quotes",(405,830,1770,1490)),
 ("pu-delivery-part","pu-c-del-top",(420,135,1770,825)),
 ("pu-delivery-part","pu-c-del-line",(420,1610,1770,1860)),
 ("pu-wanted","pu-c-wanted",(420,310,1770,830)),
 ("pu-returned","pu-c-returned",(420,830,1770,1450)),
 ("pu-bell","pu-c-bell",(0,0,1770,800)),
 ("pu-requests","pu-c-requests",(420,130,1770,760)),
 ("pr-g-order-form","pu-c-order-form",(500,845,1240,1400)),
 ("pr-g-delivery-form","pu-c-delivery-form",(345,620,1415,1625)),
 ("pr-g-ordered","pu-c-ord-top",(420,130,1770,460)),
 ("pr-g-ordered","pu-c-ord-low",(420,1450,1770,1930)),
 ("pr-e-within","pu-c-within-top",(420,130,1770,460)),
 ("pr-e-within","pu-c-within-low",(420,1255,1770,1410)),
 ("pr-e-proposed","pu-c-proposed",(420,1430,1770,1690)),
 ("pr-e-quotes","pu-c-r1-quotes",(440,890,1770,1520)),
 ("pr-f-open","pu-c-fin-wait",(420,1430,1770,1700)),
 ("pr-f-authorized","pu-c-fin-auth",(420,1440,1770,1600)),
 ("pr-g-delivery-1","pu-c-r1-del",(420,1770,1770,2050)),
 ("pr-g-invoice-form","pu-c-r1-invoice",(505,725,1245,1520)),
 ("pr-h-verified","pu-c-fin-verified",(420,1315,1770,1610)),
 ("pr-h-paid","pu-c-paid-top",(420,130,1770,515)),
 ("pr-h-paid","pu-c-paid-low",(420,2235,1770,2500)),
 ("pr-h-asha-done","pu-c-asha-done",(420,380,1770,800)),
 ("pr-a-detail","pu-c-asker-sent",(290,470,1480,1480)),
 ("pr-e-proposed","pu-c-proposed-top",(420,130,1770,460)),
 ("pr-h-disputed","pu-c-fin-disputed",(420,1085,1770,1570)),
 ("pr-h-pay-form","pu-c-fin-pay-form",(500,885,1240,1690)),
 ("pu-inventory","pu-c-inventory",(410,440,1770,1105)),
 ("pu-tab-quote","pu-c-tab-quote",(0,190,99999,99999)),
 ("pu-x-r7-propose","pu-c-tab-authorize",(0,190,99999,99999)),
 ("pu-x-r7-ready","pu-c-tab-order",(0,190,99999,99999)),
 ("pu-tab-delivery","pu-c-tab-delivery",(0,190,99999,99999)),
 ("pu-tab-invoices","pu-c-tab-invoices",(0,190,99999,99999)),
 ("pu-tab-closed","pu-c-tab-closed",(0,190,99999,99999)),
]
only=sys.argv[1:]
for src,new,box in C:
    if only and new not in only: continue
    im=Image.open(S+src+".jpg"); w,h=im.size
    b=(max(0,box[0]),max(0,box[1]),min(w,box[2]),min(h,box[3]))
    im.crop(b).save(S+new+".jpg",quality=90)
    try: meta=json.load(open(S+src+".txt"))
    except Exception: meta={}
    meta.update({"clip":True,"view":"desk","cropOf":src})
    json.dump(meta,open(S+new+".txt","w"))
    print(new,b,(b[2]-b[0],b[3]-b[1]))
