import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { AccountsBoard } from "./accounts-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Accounts") };
}

export default async function AccountsPage({ searchParams }: PageProps<"/staff/finance/accounts">) {
  return <AccountsBoard sp={await searchParams} />;
}
