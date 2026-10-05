/** While the hotel loads after the scan: the opening's own shape (the dark photo, the words, the booking bar) — never a blank page. */
export default function Loading() {
  const block = "vlh-shimmer block rounded-2xl bg-white/[0.07]";
  return (
    <main className="vr min-h-svh bg-(--vr-bg)" aria-busy="true" aria-label="Loading">
      <section className="relative bg-(--vr-dark)">
        <div className="h-[61svh] min-h-[380px] max-h-[640px] bg-linear-to-b from-white/[0.06] to-transparent lg:h-[min(90svh,880px)] lg:max-h-none" />
        <div className="absolute inset-x-0 top-0 mx-auto flex max-w-7xl items-center gap-2.5 px-4 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pt-7">
          <span className="grid size-10 place-items-center rounded-full bg-(--vr-dark) ring-[1.5px] ring-[#e3bd6a]/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-8 rounded-full" />
          </span>
          <span className={`${block} h-3 w-36 rounded-full`} />
        </div>
        <div className="relative -mt-[132px] px-4 pb-7 sm:px-6 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:px-0 lg:pb-14">
          <div className="mx-auto max-w-7xl space-y-3 lg:px-10">
            <span className={`${block} h-3 w-40 rounded-full`} />
            <span className={`${block} h-11 w-4/5 max-w-xl lg:h-16`} />
            <span className={`${block} h-4 w-3/5 max-w-sm`} />
            <span className={`${block} mt-5 h-[124px] w-full rounded-[26px] lg:h-[76px] lg:max-w-4xl lg:rounded-full`} />
          </div>
        </div>
      </section>
    </main>
  );
}
