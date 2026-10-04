import Image from "next/image";
import Link from "next/link";

/** Site-wide 404 for addresses outside the public and staff sections. */
export default function NotFound() {
  return (
    <main className="dark flex min-h-svh flex-1 flex-col items-center justify-center bg-[#15120e] px-6 text-center text-white">
      <Image src="/brand/logo-192.png" alt="Vegas Luxury Hotel" width={88} height={88} />
      <p className="mt-8 text-[11px] uppercase tracking-[0.32em] text-gold">Page not found</p>
      <h1 className="mt-4 max-w-xl font-display text-[clamp(2.2rem,5vw,3.5rem)] font-medium leading-tight">We couldn’t find that page</h1>
      <p className="mt-4 max-w-md text-white/70">The link may be old or mistyped. Let’s get you back to the hotel.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="rounded-full bg-gold px-6 py-3 text-sm font-semibold text-[#15120e] transition-transform hover:-translate-y-0.5">Back to the home page</Link>
        <Link href="/book" className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-gold">Book a room</Link>
      </div>
    </main>
  );
}
