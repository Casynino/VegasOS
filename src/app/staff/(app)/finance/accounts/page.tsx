import type { Metadata } from "next";
import { AccountsBoard } from "./accounts-board";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: PageProps<"/staff/finance/accounts">) {
  return <AccountsBoard sp={await searchParams} />;
}
