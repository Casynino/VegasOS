/** While the hotel loads after the scan: the app's own shape at once (the dark band, the photo, the buttons) — never a blank page. */
export default function Loading() {
  const block = "vlh-shimmer block rounded-2xl bg-white/[0.07]";
  return (
    <main className="vr min-h-svh bg-(--vr-bg)" aria-busy="true" aria-label="Loading">
      <section className="bg-(--vr-dark) px-4 pb-8 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-full bg-(--vr-dark) ring-[1.5px] ring-[#e3bd6a]/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-192.png" alt="" className="size-8 rounded-full" />
            </span>
            <span className={`${block} h-3 w-36 rounded-full`} />
          </div>
          <div className="mt-4 grid gap-5 md:grid-cols-2 md:items-center md:gap-8">
            <span className={`${block} aspect-[16/11] rounded-[28px] md:order-last md:aspect-[4/5] lg:aspect-[5/4]`} />
            <div className="space-y-3">
              <span className={`${block} h-6 w-32 rounded-full`} />
              <span className={`${block} h-11 w-4/5`} />
              <span className={`${block} h-7 w-3/5`} />
              <div className="grid max-w-md grid-cols-2 gap-2.5 pt-2"><span className={`${block} h-12 rounded-full`} /><span className={`${block} h-12 rounded-full`} /></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
