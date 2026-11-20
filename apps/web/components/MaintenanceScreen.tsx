import { getMessages } from '@/lib/i18n/server';

/**
 * 站点维护页：替换整棵顾客端页面（root layout 渲染），因此不出现 header/footer 导航入口。
 * 保留品牌标识与站点配色，深浅主题跟随现有 token；内容固定一屏内，不产生页面级滚动。
 * 维护文案本身来自站点设置（不翻译），标题与说明走后端字典。
 */
export default async function MaintenanceScreen({ message }: { message: string }) {
  const m = await getMessages();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper px-6 py-8">
      <div className="flex w-full max-w-[560px] flex-col items-center gap-5 rounded-[24px] border border-line bg-card px-6 py-8 text-center shadow-perk sm:gap-6 sm:px-10 sm:py-10">
        <span className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-500 text-[22px] font-bold text-white">
            捎
          </span>
          <span className="text-[22px] font-extrabold tracking-[1px] text-brand-700">捎点啥</span>
        </span>

        <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-brand-700">
          <svg
            className="h-8 w-8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-[24px] font-extrabold leading-[1.3] text-ink sm:text-[26px]">
            {m.common.maintenanceTitle}
          </h1>
          <p className="m-0 text-[15px] leading-[1.7] text-ink-2 sm:text-[16px]">{message}</p>
        </div>

        <p className="m-0 text-[13px] leading-[1.6] text-ink-3">{m.common.maintenanceNote}</p>
      </div>
    </div>
  );
}
