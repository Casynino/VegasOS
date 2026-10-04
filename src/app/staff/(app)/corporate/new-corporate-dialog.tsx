"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuickCompanyDialog } from "@/components/staff/company/quick-company";

/** Add company — a simple form with the company's people; opens the new company's page. */
export function NewCorporateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> Add company</Button>
      <QuickCompanyDialog open={open} onOpenChange={setOpen} chooseKind onSaved={(c) => router.push(`/staff/corporate/${c.id}`)} />
    </>
  );
}
