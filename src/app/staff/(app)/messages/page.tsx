import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { formatDateTime } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { HandledButton } from "./handled-button";

export const metadata: Metadata = { title: "Website messages" };

export default async function MessagesPage() {
  await requirePagePermission("contact.view");
  const messages = await db.contactMessage.findMany({ orderBy: [{ handledAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 100 });
  return (
    <div className="w-full">
      <PageHeader title="Website messages" description="Enquiries sent through the hotel website contact form." />
      {messages.length === 0 ? <EmptyState icon={<Mail />} title="No messages yet" description="Enquiries from the website contact form will appear here." /> : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card key={m.id} className={m.handledAt ? "opacity-60" : ""}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{m.name}{m.subject && <Badge variant="outline" className="ml-2">{m.subject}</Badge>}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.phone && <a className="hover:underline" href={`tel:${m.phone}`}>{m.phone}</a>}{m.phone && m.email && " · "}
                      {m.email && <a className="hover:underline" href={`mailto:${m.email}`}>{m.email}</a>} · {formatDateTime(m.createdAt)}
                    </p>
                  </div>
                  {m.handledAt ? <Badge variant="secondary">handled</Badge> : <HandledButton id={m.id} />}
                </div>
                <p className="whitespace-pre-line text-sm">{m.message}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
