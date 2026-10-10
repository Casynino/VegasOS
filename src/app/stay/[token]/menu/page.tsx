import { redirect } from "next/navigation";
import { guestLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

/** Older links to the stay's menu: the menu is now on the stay page itself. */
export default async function StayMenuPage({ params }: PageProps<"/stay/[token]/menu">) {
  await guestLocale();
  const { token } = await params;
  redirect(`/stay/${token}#order`);
}
