'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { loginAction, sendCodeAction, type LoginState } from '@/lib/auth-actions';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useMessages } from '@/components/LocaleProvider';
import { formatMessage } from '@/lib/i18n/config';

type Mode = 'login' | 'register';
type FieldErrors = { phone?: string; code?: string; name?: string };

const DEV_CODE = '123456';
const COUNTDOWN_SECONDS = 60;
const VARIANTS: Mode[] = ['login', 'register'];

const PHONE_RULE = /^1[3-9]\d{9}$/;

const INPUT_BASE =
  'h-[60px] w-full min-w-0 rounded-[14px] border-[1.5px] bg-card-soft px-[18px] text-[21px] text-ink outline-none transition focus:border-2 focus:border-brand-500 focus:bg-card focus:ring-4 focus:ring-brand-500/15 disabled:bg-card-soft';

function Icon({ name, className = 'h-[22px] w-[22px]' }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  switch (name) {
    case 'bag':
      return (
        <svg {...common}>
          <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case 'shop':
      return (
        <svg {...common}>
          <path d="M4 9l1.5-5h13L20 9" />
          <path d="M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11z" />
          <path d="M5 13v7h14v-7" />
        </svg>
      );
    case 'big':
      return (
        <svg {...common}>
          <path d="M3 18L7.5 6l4.5 12M4.6 14h5.8M15 18l2.8-7 2.7 7M15.9 16h3.8" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...common}>
          <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
        </svg>
      );
    case 'tool':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const m = useMessages();
  const t = m.auth;
  const PERKS: Record<Mode, { icon: 'shop' | 'big' | 'heart' | 'num'; title: string; desc: string; num?: string }[]> = {
    login: [
      { icon: 'shop', title: t.perkShopTitle, desc: t.perkShopDesc },
      { icon: 'big', title: t.perkBigTitle, desc: t.perkBigDesc },
      { icon: 'heart', title: t.perkHeartTitle, desc: t.perkHeartDesc }
    ],
    register: [
      { icon: 'num', num: '1', title: t.stepPhoneTitle, desc: t.stepPhoneDesc },
      { icon: 'num', num: '2', title: t.stepCodeTitle, desc: t.stepCodeDesc },
      { icon: 'num', num: '3', title: t.stepNameTitle, desc: t.stepNameDesc }
    ]
  };
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [countdown, setCountdown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(loginAction, {});

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  function validatePhone(value: string) {
    if (!value.trim()) return t.phoneRequired;
    if (!PHONE_RULE.test(value.replace(/\s/g, ''))) return t.phoneInvalid;
    return undefined;
  }

  function validate() {
    const nextErrors: FieldErrors = { phone: validatePhone(phone) };
    if (!code.trim()) {
      nextErrors.code = t.codeRequired;
    } else if (!/^\d{6}$/.test(code.trim())) {
      nextErrors.code = t.codeInvalid;
    } else if (code.trim() !== DEV_CODE) {
      nextErrors.code = formatMessage(t.codeMismatch, { code: DEV_CODE });
    }
    if (mode === 'register' && !name.trim()) {
      nextErrors.name = t.nameRequired;
    }
    setErrors(nextErrors);
    return !Object.values(nextErrors).some(Boolean);
  }

  async function handleSendCode() {
    const phoneError = validatePhone(phone);
    if (phoneError) {
      setErrors((prev) => ({ ...prev, phone: phoneError }));
      return;
    }
    setErrors((prev) => ({ ...prev, phone: undefined }));
    setSendingCode(true);
    const result = await sendCodeAction(phone);
    setSendingCode(false);
    if (!result.ok) {
      setErrors((prev) => ({ ...prev, phone: result.message }));
      return;
    }
    setCodeSent(true);
    setCountdown(COUNTDOWN_SECONDS);
  }

  function handleClientSubmit(event: React.FormEvent<HTMLFormElement>) {
    // 先做客户端校验拦截，通过后交给 Server Action 调真实接口
    if (!validate()) event.preventDefault();
  }

  /** 左侧宣传 / 说明区：两种模式各渲染一份，叠在同一网格单元里，取较高者撑高页面 */
  function renderAside(variant: Mode) {
    const isLoginVariant = variant === 'login';
    return (
      <aside
        key={variant}
        aria-hidden={variant !== mode}
        inert={variant !== mode}
        className={`[grid-area:aside] flex w-full flex-col gap-[22px] xl:w-[520px] ${variant === mode ? '' : 'invisible'}`}
      >
        <h1 className="m-0 text-[44px] font-extrabold tracking-[2px] text-brand-700">
          {isLoginVariant ? t.brand : t.registerBrand}
        </h1>
        <p className="-mt-2 mb-1.5 text-[24px] leading-[1.5] font-semibold text-ink">
          {isLoginVariant ? t.loginSlogan : t.registerSlogan}
        </p>
        {PERKS[variant].map((perk) => (
          <div key={perk.title} className="flex items-center gap-4 rounded-2xl bg-card px-[18px] py-4 shadow-perk">
            <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] bg-brand-50 text-brand-700">
              {perk.icon === 'num' ? (
                <b className="text-[22px]">{perk.num}</b>
              ) : (
                <Icon name={perk.icon} className="h-[26px] w-[26px]" />
              )}
            </span>
            <div>
              <b className="block text-[20px] text-ink">{perk.title}</b>
              <span className="text-[16px] text-ink-2">{perk.desc}</span>
            </div>
          </div>
        ))}
      </aside>
    );
  }

  /** 右侧卡片：同样叠两份、隐藏非当前态，两张卡高度自然对齐到较高者 */
  function renderCard(variant: Mode) {
    const isLoginVariant = variant === 'login';
    const fieldId = (field: string) => `${field}-${variant}`;

    return (
      <section
        key={variant}
        aria-hidden={variant !== mode}
        inert={variant !== mode}
        className={`[grid-area:card] mx-auto w-full min-w-0 max-w-[540px] rounded-3xl bg-card px-[34px] pb-[26px] pt-7 shadow-auth ${
          variant === mode ? '' : 'invisible'
        }`}
      >
        <form className="flex h-full flex-col gap-3" action={formAction} onSubmit={handleClientSubmit} noValidate>
          <input type="hidden" name="mode" value={variant} />
          {next ? <input type="hidden" name="next" value={next} /> : null}

          {state.error ? (
            <p className="rounded-[10px] bg-danger-soft px-3 py-2 text-[16px] text-danger">{state.error}</p>
          ) : null}

          <div className="grid grid-cols-2 rounded-2xl bg-segment p-[5px]">
            <Link
              href="/login"
              className={`grid h-[54px] place-items-center rounded-xl text-[21px] ${
                mode === 'login'
                  ? 'bg-card font-extrabold text-brand-700 shadow-segment'
                  : 'font-semibold text-ink-2'
              }`}
            >
              {m.nav.login}
            </Link>
            <Link
              href="/login?mode=register"
              className={`grid h-[54px] place-items-center rounded-xl text-[21px] ${
                mode === 'register'
                  ? 'bg-card font-extrabold text-brand-700 shadow-segment'
                  : 'font-semibold text-ink-2'
              }`}
            >
              {t.registerTab}
            </Link>
          </div>

          <label htmlFor={fieldId('phone')} className="sr-only">
            {t.phoneLabel}
          </label>
          <input
            id={fieldId('phone')}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            disabled={isPending}
            onChange={(event) => {
              setPhone(event.target.value);
              setErrors((prev) => ({ ...prev, phone: undefined }));
            }}
            placeholder={t.phonePlaceholder}
            aria-invalid={Boolean(errors.phone)}
            className={`${INPUT_BASE} mt-1 placeholder:font-normal placeholder:text-ink-3 ${
              errors.phone ? 'border-danger' : 'border-line'
            }`}
          />
          {errors.phone ? <p className="text-[15px] text-danger">{errors.phone}</p> : null}

          <label htmlFor={fieldId('code')} className="sr-only">
            {t.codeLabel}
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
            <input
              id={fieldId('code')}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={isPending}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, ''));
                setErrors((prev) => ({ ...prev, code: undefined }));
              }}
              placeholder={t.codePlaceholder}
              aria-invalid={Boolean(errors.code)}
              className={`${INPUT_BASE} tracking-[2px] placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-3 ${
                errors.code ? 'border-danger' : 'border-line'
              }`}
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={isPending || sendingCode || countdown > 0}
              className="h-[60px] rounded-[14px] border-[1.5px] border-brand-200 bg-brand-50 text-[18px] font-bold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:border-line disabled:bg-segment disabled:text-ink-3"
            >
              {sendingCode
                ? t.sendingCode
                : countdown > 0
                  ? formatMessage(t.resendIn, { count: countdown })
                  : t.sendCode}
            </button>
          </div>
          {errors.code ? <p className="text-[15px] text-danger">{errors.code}</p> : null}
          {codeSent ? (
            <p className="rounded-[10px] bg-brand-50 px-3 py-2 text-[16px] text-brand-700">
              {formatMessage(t.codeSentNote, { code: DEV_CODE })}
            </p>
          ) : null}

          {!isLoginVariant ? (
            <>
              <label htmlFor={fieldId('name')} className="sr-only">
                {t.nameLabel}
              </label>
              <input
                id={fieldId('name')}
                name="name"
                value={name}
                disabled={isPending}
                maxLength={20}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                placeholder={t.namePlaceholder}
                aria-invalid={Boolean(errors.name)}
                className={`${INPUT_BASE} placeholder:font-normal placeholder:text-ink-3 ${
                  errors.name ? 'border-danger' : 'border-line'
                }`}
              />
              {errors.name ? <p className="text-[15px] text-danger">{errors.name}</p> : null}
            </>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className="mt-2 h-[62px] w-full rounded-[14px] bg-primary text-[21px] font-bold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-segment disabled:text-ink-3"
          >
            {isPending
              ? isLoginVariant
                ? t.loginPending
                : t.registerPending
              : isLoginVariant
                ? m.nav.login
                : t.registerSubmit}
          </button>

          {!isLoginVariant ? (
            <p className="text-center text-[15px] text-ink-3">
              {t.agreementPrefix}{' '}
              <b className="font-semibold text-brand-700">{t.terms}</b> {t.agreementAnd}{' '}
              <b className="font-semibold text-brand-700">{t.privacy}</b>
            </p>
          ) : null}

          <p className="text-center text-[17px] text-ink-2">
            {isLoginVariant ? (
              <>
                {t.firstTimePrefix}
                <b className="text-brand-700">{t.registerTab}</b>
                {t.firstTimeSuffix}
              </>
            ) : (
              <>
                {t.registeredPrefix}
                <b className="text-brand-700">{m.nav.login}</b>
                {t.registeredSuffix}
              </>
            )}
          </p>

          <div className="mt-auto flex items-start gap-2.5 rounded-xl bg-amber-soft px-3.5 py-2.5 text-[15px] leading-relaxed text-amber-ink">
            <Icon name="tool" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
            <span>{formatMessage(t.devNote, { code: DEV_CODE })}</span>
          </div>
        </form>
      </section>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1120px] flex-1 content-start gap-12 pb-6 xl:grid-cols-[520px_minmax(0,1fr)] xl:gap-14">
      <LoadingOverlay
        show={isPending || sendingCode}
        text={
          sendingCode
            ? t.loadingCode
            : mode === 'register'
              ? t.loadingRegister
              : t.loadingLogin
        }
      />
      <div className="grid [grid-template-areas:'aside'] content-center">{VARIANTS.map(renderAside)}</div>
      <div className="grid min-w-0 [grid-template-areas:'card']">{VARIANTS.map(renderCard)}</div>
    </div>
  );
}
