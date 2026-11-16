'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 标签切换时沿标签栏底部滑过的细进度条。
 * 视觉与动效复刻 sharp admin 顶栏的 route-progress：32% 宽的主色条从左侧滑入，
 * 一个完整动画周期后消失；切换过快时也至少展示一次完整扫过，避免一闪而过。
 */
export function TabProgress({ activeKey }: { activeKey: string }) {
  const [visible, setVisible] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    // 首帧不展示，只在真正切换标签时出现
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 1000);
    return () => window.clearTimeout(timer);
  }, [activeKey]);

  if (!visible) return null;

  return (
    <div className="tab-progress" aria-hidden>
      <span />
    </div>
  );
}
