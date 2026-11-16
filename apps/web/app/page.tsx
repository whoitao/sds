import { HelloCard } from '@sds/ui';
import { ROLES, ORDER_STATUS_LABELS } from '@sds/shared';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 px-6 py-16">
      <HelloCard
        title="Hello 捎点啥 · Web 顾客端"
        description="这是 Next.js 端的 HelloWorld 页面，共享包 @sds/ui 与 @sds/shared 均已生效。"
      />
      <ul className="text-senior-base leading-relaxed text-[#5c6672]">
        <li>角色示例：{ROLES.CUSTOMER}</li>
        <li>订单状态示例：{ORDER_STATUS_LABELS.pending_payment}</li>
        <li>Tailwind 自定义字号：text-senior-base（18px）</li>
      </ul>
      <a className="text-senior-lg text-brand-600 underline" href="http://localhost:8787">
        访问 API：http://localhost:8787
      </a>
    </main>
  );
}
