import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

/**
 * 站点公共骨架：header + 内容区 + footer。
 * 桌面（lg 及以上）固定一屏：整页不滚动，内容区高度自适应可用空间、上限 700px，
 * 封顶后内容块停靠在 main 顶部，多出来的高度留在下方；内容溢出由 main 内的滚动容器承担。
 * 滚动容器不预留 scrollbar-gutter：没有溢出时右侧不占额外宽度，内容右缘与 header 严格对齐；
 * macOS 的覆盖式滚动条只在滚动时浮出，不占布局宽度。
 * 手机断点（lg 以下）保持自然流式，整页滚动。
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      <SiteHeader />
      <div className="flex flex-1 flex-col lg:min-h-0">
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-6 lg:min-h-0 lg:max-h-[700px]">
          <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
            {children}
          </div>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
