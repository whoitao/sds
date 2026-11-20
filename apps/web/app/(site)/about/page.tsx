import type { Metadata } from 'next';
import { getMessages } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: '关于 · 捎点啥'
};

const CARD = 'rounded-[20px] border border-line bg-card p-4 shadow-perk sm:p-5';
const LIST = 'm-0 flex list-disc flex-col gap-1.5 pl-5 text-[16px] leading-[1.65] text-ink-2';

export default async function AboutPage() {
  const m = (await getMessages()).site;
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pt-3">
      <section className={CARD}>
        <h1 className="m-0 text-[24px] font-extrabold text-ink">{m.aboutTitle}</h1>
        <p className="mt-2 text-[16px] leading-[1.7] text-ink-2">{m.aboutIntro}</p>
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[19px] font-extrabold text-ink">{m.aboutHowTitle}</h2>
        <ol className="m-0 mt-2.5 flex list-decimal flex-col gap-1.5 pl-5 text-[16px] leading-[1.65] text-ink-2">
          <li>{m.aboutHow1}</li>
          <li>{m.aboutHow2}</li>
          <li>{m.aboutHow3}</li>
          <li>{m.aboutHow4}</li>
        </ol>
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[19px] font-extrabold text-ink">{m.aboutSupportTitle}</h2>
        <ul className={`${LIST} mt-2.5`}>
          <li>{m.aboutSupport1}</li>
          <li>{m.aboutSupport2}</li>
          <li>{m.aboutSupport3}</li>
        </ul>
      </section>

      <p className="m-0 px-1 text-[15px] leading-[1.6] text-ink-3">{m.aboutSlogan}</p>
    </div>
  );
}
