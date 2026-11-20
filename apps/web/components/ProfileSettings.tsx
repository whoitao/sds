'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { sendCodeAction } from '@/lib/auth-actions';
import {
  removeAvatarAction,
  resetPasswordAction,
  updateNicknameAction,
  uploadAvatarAction,
  type ProfileState
} from '@/lib/profile-actions';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useMessages } from '@/components/LocaleProvider';
import { formatMessage } from '@/lib/i18n/config';

const CARD = 'flex flex-col gap-2 rounded-[20px] border border-line bg-card p-4 shadow-perk sm:p-5';
const INPUT =
  'h-12 w-full min-w-0 rounded-xl border-[1.5px] border-line bg-card-soft px-3.5 text-[16px] text-ink outline-none transition placeholder:text-ink-3 focus:border-2 focus:border-brand-500 focus:bg-card focus:ring-4 focus:ring-brand-500/15';
const BTN_PRIMARY =
  'inline-flex h-12 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-[16px] font-bold text-white transition-colors hover:bg-primary-hover disabled:opacity-60';
const BTN_GHOST =
  'inline-flex h-12 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line px-5 text-[16px] font-bold text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-60';
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
const COUNTDOWN_SECONDS = 60;

function maskPhone(phone: string | null) {
  if (!phone || phone.length !== 11) return phone ?? '';
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

function Feedback({ state }: { state: ProfileState }) {
  if (!state.error && !state.message) return null;
  return (
    <p
      className={`m-0 mt-3 rounded-xl px-3.5 py-2.5 text-[14px] ${
        state.error ? 'bg-danger-soft text-danger' : 'bg-brand-50 text-brand-700'
      }`}
      role={state.error ? 'alert' : 'status'}
    >
      {state.error ?? state.message}
    </p>
  );
}

export default function ProfileSettings({
  nickname,
  phone,
  avatarUrl
}: {
  nickname: string;
  phone: string | null;
  avatarUrl: string | null;
}) {
  const m = useMessages();
  const t = m.account;
  const [avatar, setAvatar] = useState<string | null>(avatarUrl);
  const [fileError, setFileError] = useState<string | null>(null);
  const [avatarNotice, setAvatarNotice] = useState<ProfileState>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarState, uploadAvatar, uploading] = useActionState(uploadAvatarAction, {});
  const [removeState, removeAvatar, removing] = useActionState(removeAvatarAction, {});

  const [nicknameState, saveNickname, savingNickname] = useActionState(updateNicknameAction, {});
  const [passwordState, resetPassword, resetting] = useActionState(resetPasswordAction, {});

  const [sendingCode, setSendingCode] = useState(false);
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (avatarState.avatarUrl) setAvatar(avatarState.avatarUrl);
    if (avatarState.message) {
      setFileError(null);
      if (fileRef.current) fileRef.current.value = '';
    }
    setAvatarNotice(
      avatarState.error
        ? { error: avatarState.error }
        : avatarState.message
          ? { message: avatarState.message }
          : {}
    );
  }, [avatarState]);

  useEffect(() => {
    if (removeState.avatarUrl === null) setAvatar(null);
    if (!removeState.error && !removeState.message) return;
    setFileError(null);
    setAvatarNotice(
      removeState.error ? { error: removeState.error } : { message: removeState.message }
    );
  }, [removeState]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setFileError(t.avatarTypeError);
      event.target.value = '';
      return;
    }
    if (file.size > AVATAR_MAX_SIZE) {
      setFileError(t.avatarSizeError);
      event.target.value = '';
      return;
    }
    setFileError(null);
    event.target.form?.requestSubmit();
  }

  async function handleSendCode() {
    if (!phone) {
      setCodeError(t.noPhone);
      return;
    }
    setSendingCode(true);
    const result = await sendCodeAction(phone);
    setSendingCode(false);
    if (!result.ok) {
      setCodeError(result.message ?? t.sendCodeFailed);
      return;
    }
    setCodeError(null);
    setCountdown(COUNTDOWN_SECONDS);
    setCodeHint(
      result.devMode
        ? formatMessage(t.codeDevHint, { code: result.devCode })
        : t.codeSent
    );
  }

  const avatarFeedback: ProfileState = fileError ? { error: fileError } : avatarNotice;

  return (
    <>
      <LoadingOverlay
        show={uploading || removing || savingNickname || resetting || sendingCode}
        text={
          uploading
            ? t.loadingAvatar
            : sendingCode
              ? t.loadingCode
              : t.loadingSaving
        }
      />
      <section className={CARD}>
        <h2 className="m-0 text-[17px] font-bold text-ink">{t.avatarTitle}</h2>
        <p className="m-0 text-[14px] text-ink-3">{t.avatarHint}</p>
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-[28px] font-bold text-brand-700">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt={t.avatarAlt}
                width={160}
                height={160}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              (nickname.trim()[0] ?? t.avatarFallback)
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <form action={uploadAvatar}>
              <input
                ref={fileRef}
                type="file"
                name="avatar"
                accept={AVATAR_TYPES.join(',')}
                className="sr-only"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={BTN_PRIMARY}
              >
                {uploading ? t.avatarUploading : t.avatarChange}
              </button>
            </form>
            {avatar ? (
              <form action={removeAvatar}>
                <button type="submit" disabled={removing} className={BTN_GHOST}>
                  {removing ? t.avatarRemoving : t.avatarRemove}
                </button>
              </form>
            ) : null}
          </div>
        </div>
        <Feedback state={avatarFeedback} />
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[17px] font-bold text-ink">{t.nicknameTitle}</h2>
        <p className="m-0 text-[14px] text-ink-3">{t.nicknameHint}</p>
        <form action={saveNickname} className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t.nicknameLabel}</span>
            <input
              name="nickname"
              defaultValue={nicknameState.nickname ?? nickname}
              maxLength={20}
              autoComplete="nickname"
              placeholder={t.nicknamePlaceholder}
              className={INPUT}
            />
          </label>
          <button type="submit" disabled={savingNickname} className={BTN_PRIMARY}>
            {savingNickname ? m.common.saving : m.common.save}
          </button>
        </form>
        <Feedback state={nicknameState} />
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[17px] font-bold text-ink">{t.passwordTitle}</h2>
        <p className="m-0 text-[14px] text-ink-3">
          {formatMessage(t.passwordHint, { phone: maskPhone(phone) })}
        </p>
        <form action={resetPassword} className="mt-2 flex flex-col gap-3">
          <input type="hidden" name="phone" value={phone ?? ''} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t.codeLabel}</span>
              <input
                name="code"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder={t.codePlaceholder}
                className={`${INPUT} tracking-[2px] placeholder:tracking-normal`}
              />
            </label>
            <button
              type="button"
              onClick={handleSendCode}
              disabled={sendingCode || countdown > 0 || !phone}
              className={`${BTN_GHOST} sm:w-[148px]`}
            >
              {countdown > 0
                ? formatMessage(t.codeResendIn, { count: countdown })
                : sendingCode
                  ? t.codeSending
                  : t.codeSend}
            </button>
          </div>
          {codeError ? <p className="m-0 text-[14px] text-danger">{codeError}</p> : null}
          {codeHint ? <p className="m-0 text-[14px] text-ink-2">{codeHint}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="sr-only">{t.newPasswordLabel}</span>
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                placeholder={t.newPasswordPlaceholder}
                className={INPUT}
              />
            </label>
            <label className="min-w-0">
              <span className="sr-only">{t.confirmPasswordLabel}</span>
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                placeholder={t.confirmPasswordPlaceholder}
                className={INPUT}
              />
            </label>
          </div>
          <div>
            <button type="submit" disabled={resetting} className={BTN_PRIMARY}>
              {resetting ? m.common.submitting : t.resetSubmit}
            </button>
          </div>
        </form>
        <Feedback state={passwordState} />
      </section>
    </>
  );
}
