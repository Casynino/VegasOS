"use client";

import { useT } from "@/i18n/client";

/** While the booking loads: the confirmation's own shape (the dark band with the reference, the details card). */
export default function Loading() {
  const t = useT();
  const dark = "vlh-shimmer block rounded-2xl bg-white/[0.07]";
  const light = "vlh-shimmer block rounded-2xl bg-(--vr-line)/70";
  return (
    <main className="vr min-h-svh bg-(--vr-bg)" aria-busy="true" aria-label={t("Loading your booking")}>
      <section className="bg-(--vr-dark) px-4 pb-8 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center">
          <span className={`${dark} size-16 rounded-full`} />
          <span className={`${dark} mt-4 h-9 w-56`} />
          <span className={`${dark} mt-3 h-4 w-64`} />
          <span className={`${dark} mt-6 h-[74px] w-64`} />
        </div>
      </section>
      <div className="mx-auto mt-5 max-w-5xl space-y-2 px-4 sm:px-6">
        {[0, 1, 2, 3, 4].map((k) => <span key={k} className={`${light} h-11 w-full`} />)}
      </div>
    </main>
  );
}
