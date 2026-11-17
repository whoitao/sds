import type { Metadata } from 'next';
import Link from 'next/link';

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

export default function HelpPage() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pt-3">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[24px] font-extrabold text-ink">帮助</h1>
        <p className="m-0 text-[16px] leading-[1.6] text-ink-2">
          照着下面几步就能买到菜；写到的功能都是站内现在能用的。
        </p>
      </div>

      <Topic title="怎么买菜">
        <ul className={LIST}>
          <li>
            打开首页的「附近的店」，点「打开定位」按当前位置找店；也可以用「3 公里内」「只看营业中」筛选，列表里会显示门店今天的营业时间。
          </li>
          <li>选好门店点「选他」进店挑菜，挑好放进购物车；加购需要先登录。</li>
          <li>
            门店休息中今天不接单，要等营业时间再来。标着「今天卖完了」的商品不能加购，也不会算进合计、不能结算。
          </li>
        </ul>
      </Topic>

      <Topic title="怎么拿菜、怎么付钱">
        <ul className={LIST}>
          <li>
            结算页选「送货到家」或「我去店里拿」。送货到家要先有收货地址，本页可直接换地址；到店自提会显示门店地址，做好后门店会通知你。
          </li>
          <li>
            付款可选「收到菜再付钱」或「现在微信付」。线上支付暂未开通：选微信付不会发起扣款，订单会保留为待支付，请保留订单号并联系门店付款。
          </li>
          <li>门店的营业时间和接单状态会影响能不能下单、什么时候送到；能不能送也以门店接单为准。</li>
        </ul>
      </Topic>

      <Topic title="订单">
        <ul className={LIST}>
          <li>一店一单：不同门店的菜不能合成一单，需要分开结算；同一家店的菜可以一起提交。</li>
          <li>
            订单状态有待支付、待接单、备货中、配送中、待自提、已完成、退款中、已取消、已退款，以订单页实际显示为准。
          </li>
          <li>
            顶栏头像菜单里点「我的订单」，或直接打开{' '}
            <Link href="/orders" className={LINK}>
              我的订单
            </Link>
            ，点任一订单能看商品、地址或自提门店、支付方式和当前状态。订单信息以门店确认为准。
          </li>
          <li>需要取消或改单，请在营业时间内直接联系门店。</li>
        </ul>
      </Topic>

      <Topic title="账号">
        <ul className={LIST}>
          <li>用手机号和短信验证码登录；新手机号在「注册」里填手机号、验证码和姓名即可开通。</li>
          <li>
            在{' '}
            <Link href="/profile" className={LINK}>
              个人信息
            </Link>
            {' '}里可以改用户名（2–20 个字，不能带空格）、上传或移除头像（JPG / PNG / WebP / GIF，2MB 以内），也可以用手机验证码重置密码。
          </li>
          <li>
            在{' '}
            <Link href="/addresses" className={LINK}>
              收货地址
            </Link>
            {' '}里新增、编辑、删除地址，并设一个默认地址；下单默认用默认地址，结算页还能临时换。
          </li>
        </ul>
      </Topic>

      <Topic title="遇到问题">
        <ul className={LIST}>
          <li>站内暂时没有在线客服和电话客服入口；订单有问题先看订单详情里的门店、地址和状态，营业时间内到门店沟通最快。</li>
          <li>列表里的距离是直线距离，仅供参考；实际能不能送，以门店接单为准。</li>
        </ul>
      </Topic>
    </div>
  );
}
