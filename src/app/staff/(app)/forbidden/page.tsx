import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/i18n/server";

export default async function ForbiddenPage() {
  const t = await getT();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <h1 className="mt-4 text-xl font-semibold">{t("You don't have access to this page")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("Ask a manager or the owner if you need this permission.")}
      </p>
      <Link href="/staff" className={buttonVariants({ className: "mt-6" })}>{t("Back to today")}</Link>
    </div>
  );
}
