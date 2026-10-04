import { redirect } from "next/navigation";

/** Checkout now happens on the check-out desk, with this guest selected. */
export default async function CheckOutRedirect({ params }: PageProps<"/staff/reservations/[id]/check-out">) {
  const { id } = await params;
  redirect(`/staff/check-out?id=${encodeURIComponent(id)}#workspace`);
}
