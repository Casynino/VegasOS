import { QrCode } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { GlassPanel, HudLabel } from "../kit/hud";
import { PriceTag } from "../kit/price-tag";
import { Section } from "../kit/section";
import { typeScale } from "../kit/tokens";
import { SectionIntro } from "../kit/typography";
import { Reveal } from "../reveal";

const STEPS = [
  { title: msg("Scan the QR card in your room"), body: msg("It opens the same menu as the restaurant and the bar.") },
  { title: msg("Choose and send"), body: msg("Your order goes straight to the restaurant.") },
  { title: msg("We bring it up"), body: msg("It is added to your room bill, settled at check-out.") },
];

/**
 * Room service as a band: the invitation on one side, and on the other a "blueprint" card — the
 * three real steps of ordering from the room's QR card, with the delivery fee from Settings. Used
 * by /restaurant (#room-service, linked from the dining nav) and /menu.
 */
export async function RoomService({
  id,
  titleId,
  eyebrow,
  title,
  lede,
  actions,
  fee,
  marker,
  footnote,
}: {
  id?: string;
  titleId: string;
  eyebrow?: string;
  title: string;
  lede: string;
  actions?: React.ReactNode;
  /** Delivery fee per order (Settings → room service fee). */
  fee: number;
  marker?: { index: number; label: string };
  /** A quiet line at the band's foot (e.g. the photo credits when this is the page's last band). */
  footnote?: React.ReactNode;
}) {
  const t = await getT();
  return (
    <Section id={id} tone="deep" labelledBy={titleId} marker={marker && { ...marker, aside: <HudLabel>{t("Delivery TZS {amount}", { amount: formatNumber(fee) })}</HudLabel> }}>
      <div className="grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-10">
        <Reveal className="min-w-0 lg:col-span-6">
          {/* With an index line above, the eyebrow would repeat it. */}
          <SectionIntro eyebrow={marker ? undefined : eyebrow ?? t("Room service")} title={title} id={titleId} lede={lede} actions={actions} />
        </Reveal>
        <Reveal delay={0.1} className="min-w-0 lg:col-span-5 lg:col-start-8">
          <GlassPanel variant="paper" hud spotlight padding="lg" rounded="lg">
            <div className="flex items-center justify-between gap-4">
              <HudLabel>{t("In-room ordering")}</HudLabel>
              <span aria-hidden="true" className="grid size-11 place-items-center rounded-full border border-pub-line text-pub-eyebrow">
                <QrCode className="size-5" strokeWidth={1.4} />
              </span>
            </div>
            <ol className="mt-6 border-t border-pub-line">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-5 border-b border-pub-line py-4">
                  <span aria-hidden="true" className="pt-1 font-mono text-[11px] tracking-[0.16em] text-pub-eyebrow">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className={cn(typeScale.item, "block text-pub-fg")}>{t(step.title)}</span>
                    <span className="mt-1 block text-[14px] leading-relaxed text-pub-muted">{t(step.body)}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <span className={cn(typeScale.meta, "text-pub-muted")}>{t("Delivery, per order")}</span>
              <PriceTag amount={fee} unit={null} size="sm" />
            </div>
          </GlassPanel>
        </Reveal>
      </div>
      {footnote && <div className="mt-12 border-t border-pub-line pt-4 sm:mt-16">{footnote}</div>}
    </Section>
  );
}
