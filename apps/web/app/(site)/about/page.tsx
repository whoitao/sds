import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '关于 · 捎点啥'
};

const CARD = 'rounded-[20px] border border-line bg-card p-4 shadow-perk sm:p-5';
const LIST = 'm-0 flex list-disc flex-col gap-1.5 pl-5 text-[16px] leading-[1.65] text-ink-2';

export default function AboutPage() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pt-3">
      <section className={CARD}>
        <h1 className="m-0 text-[24px] font-extrabold text-ink">关于捎点啥</h1>
        <p className="mt-2 text-[16px] leading-[1.7] text-ink-2">
          捎点啥是给社区街坊用的买菜工具：打开就能看到附近正在营业的生鲜小店，挑好菜，送上门或者自己去店里拿。
        </p>
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[19px] font-extrabold text-ink">怎么用</h2>
        <ol className="m-0 mt-2.5 flex list-decimal flex-col gap-1.5 pl-5 text-[16px] leading-[1.65] text-ink-2">
          <li>选店：在首页看附近门店，点「选他」进店。</li>
          <li>挑菜：把要买的放进购物车，今天卖完的不能选。</li>
          <li>结算：选送货到家或到店自提，再选付款方式。</li>
          <li>取货 / 收货：到店自提，或者在家等门店送过来。</li>
        </ol>
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[19px] font-extrabold text-ink">目前支持</h2>
        <ul className={`${LIST} mt-2.5`}>
          <li>就近找店：按定位看 3 公里内的门店，也可以只看营业中的。</li>
          <li>一店一单：不同门店的菜分开结算，同一家店可以一起提交。</li>
          <li>货到付款：收到菜或到店取货时付给门店；线上支付暂未开通。</li>
        </ul>
      </section>

      <p className="m-0 px-1 text-[15px] leading-[1.6] text-ink-3">
        想让街坊买菜这件事，少走几步路。
      </p>
    </div>
  );
}
