import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><SearchX /></span>
      <h1 className="mt-4 text-xl font-semibold">{t("Not found")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("This record doesn't exist or was removed from view.")}</p>
      <Link href="/staff" className={buttonVariants({ className: "mt-6" })}>{t("Back to today")}</Link>
    </div>
  );
}
