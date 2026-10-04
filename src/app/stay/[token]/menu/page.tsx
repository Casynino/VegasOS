import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Older links to the stay's menu: the menu is now on the stay page itself. */
export default async function StayMenuPage({ params }: PageProps<"/stay/[token]/menu">) {
  const { token } = await params;
  redirect(`/stay/${token}#order`);
}
