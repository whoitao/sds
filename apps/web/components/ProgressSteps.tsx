const DEFAULT_STEPS = ['挑好菜', '怎么拿、怎么付', '下单好了'];

function CheckIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function ProgressSteps({
  current,
  steps = DEFAULT_STEPS,
  className = ''
}: {
  /** 当前进行到第几步，从 1 开始；小于它的算已完成 */
  current: number;
  /** 步骤文案，默认是买菜流程的三步 */
  steps?: readonly string[];
  className?: string;
}) {
  return (
    <ol className={`m-0 flex w-full list-none items-center gap-1.5 p-0 sm:gap-3 ${className}`}>
      {steps.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={`${step}-${label}`} className="flex items-center gap-1.5 sm:gap-2.5">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold sm:h-7 sm:w-7 sm:text-[14px] ${
                done
                  ? 'bg-brand-500 text-white'
                  : active
                    ? 'bg-primary text-white'
                    : 'bg-segment text-ink-3'
              }`}
            >
              {done ? <CheckIcon /> : step}
            </span>
            <span
              className={`whitespace-nowrap text-[12px] font-bold sm:text-[15px] ${
                active ? 'text-brand-700' : done ? 'text-ink' : 'text-ink-3'
              }`}
            >
              {label}
            </span>
            {step < steps.length ? (
              <span
                className={`h-[2px] min-w-2 flex-1 rounded-full ${
                  done ? 'bg-brand-300' : 'bg-line'
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
