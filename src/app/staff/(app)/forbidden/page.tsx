import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <h1 className="mt-4 text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask a manager or the owner if you need this permission.
      </p>
      <Link href="/staff" className={buttonVariants({ className: "mt-6" })}>Back to today</Link>
    </div>
  );
}
