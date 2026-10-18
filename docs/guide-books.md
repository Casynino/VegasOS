# Guide books page (owner, 2026-10-18)

The twelve department guide books (edition 2) are on **Staff → Guide books** (`/staff/guides`) so the Boss, the MD, the Manager and the Developer can **download** them and **share** them (the phone's share sheet with the PDF itself, WhatsApp link, copy link).

## Who can do what
- **See, download, share:** anyone holding `dashboard.admin`, `dashboard.owner`, `dashboard.manager` or `developer.access` (`GUIDE_VIEW_RIGHTS` in `src/lib/guide-books.ts`). The menu entry shows for the same people.
- **Upload and remove:** the Developer only, signed in as himself (not while working as someone). Enforced in the upload route (`src/app/api/guides/upload/route.ts`) and in both actions (`guides/actions.ts`); every upload and removal is written to the audit trail under him (`guide_book.uploaded`, `guide_book.removed`).

## Where the PDFs are
- **Not in the repository** (the GitHub repo is public, and `guides/pdf/` is git-ignored) and **not in the database** (106 MB; Vercel functions cannot return more than about 4.5 MB). They live in the hotel's Vercel Blob file storage under `guide-books/`, the same storage the hotel photos use (`BLOB_READ_WRITE_TOKEN`).
- The browser uploads each PDF straight to the storage (client upload, token from the route above). Only a file named like a book (`Vegas-Guide-07-Manager.pdf`, `GUIDE_FILE`), a PDF, at most 60 MB, is accepted; the same name replaces the old book.
- The list on the page comes from the storage (`storedGuides()`); a book not uploaded yet shows "Not uploaded yet". Without the storage token (a development computer) the page says the books cannot be listed there.

## Putting the books in (once, and after each new edition)
1. Build the books on your computer (`node guides/tools/build.mjs <id>`; they land in `guides/pdf/`).
2. Sign in as the Developer, open **Guide books**, press **Upload books**, select all twelve PDFs. They go up one after the other.
3. The Boss, MD and Manager now see them.

The books show screens from the practice copy, never the live hotel; the links to the files are plain (unlisted) storage links, so share them only with staff.
