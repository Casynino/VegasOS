import { redirect } from "next/navigation";

/** Collections moved to Finance → Collections (every kind of payment, not only the restaurant's). */
export default async function OldCollectionsPage({ searchParams }: PageProps<"/staff/restaurant/collections">) {
  const sp = await searchParams;
  const keep = Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  redirect(`/staff/collections?${new URLSearchParams({ src: "restaurant", ...keep })}`);
}
