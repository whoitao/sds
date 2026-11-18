'use client';

export function LoadingOverlay({ show, text = '正在处理，请稍候…' }: { show: boolean; text?: string }) {
  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-6 backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-card px-5 py-4 shadow-perk">
        <span
          aria-hidden
          className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 motion-reduce:animate-none"
        />
        <span className="text-[15px] font-bold text-ink">{text}</span>
      </div>
    </div>
  );
}
