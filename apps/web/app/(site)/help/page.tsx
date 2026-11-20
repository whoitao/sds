import type { Metadata } from 'next';
import Link from 'next/link';
import { getMessages } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: '帮助 · 捎点啥'
};

const CARD = 'rounded-[20px] border border-line bg-card p-4 shadow-perk sm:p-5';
const LIST = 'm-0 flex list-disc flex-col gap-2 pl-5 text-[16px] leading-[1.7] text-ink-2';
const LINK = 'font-bold text-brand-700 underline underline-offset-4 transition-colors hover:text-brand-800';

function Topic({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <h2 className="m-0 text-[19px] font-extrabold text-ink">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export default async function HelpPage() {
  const m = (await getMessages()).site;
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pt-3">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[24px] font-extrabold text-ink">{m.helpTitle}</h1>
        <p className="m-0 text-[16px] leading-[1.6] text-ink-2">{m.helpIntro}</p>
      </div>

      <Topic title={m.helpBuyTitle}>
        <ul className={LIST}>
          <li>{m.helpBuy1}</li>
          <li>{m.helpBuy2}</li>
          <li>{m.helpBuy3}</li>
        </ul>
      </Topic>

      <Topic title={m.helpPickupTitle}>
        <ul className={LIST}>
          <li>{m.helpPickup1}</li>
          <li>{m.helpPickup2}</li>
          <li>{m.helpPickup3}</li>
        </ul>
      </Topic>

      <Topic title={m.helpOrdersTitle}>
        <ul className={LIST}>
          <li>{m.helpOrders1}</li>
          <li>{m.helpOrders2}</li>
          <li>
            {m.helpOrders3Pre}
            <Link href="/orders" className={LINK}>
              {m.myOrders}
            </Link>
            {m.helpOrders3Post}
          </li>
          <li>{m.helpOrders4}</li>
        </ul>
      </Topic>

      <Topic title={m.helpAccountTitle}>
        <ul className={LIST}>
          <li>{m.helpAccount1}</li>
          <li>
            {m.helpAccount2Pre}
            <Link href="/profile" className={LINK}>
              {m.profileName}
            </Link>
            {m.helpAccount2Post}
          </li>
          <li>
            {m.helpAccount3Pre}
            <Link href="/addresses" className={LINK}>
              {m.addressesName}
            </Link>
            {m.helpAccount3Post}
          </li>
        </ul>
      </Topic>

      <Topic title={m.helpProblemsTitle}>
        <ul className={LIST}>
          <li>{m.helpProblems1}</li>
          <li>{m.helpProblems2}</li>
        </ul>
      </Topic>
    </div>
  );
}
