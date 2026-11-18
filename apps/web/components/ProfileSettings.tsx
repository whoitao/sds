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
      setFileError('仅支持 JPG / PNG / WebP / GIF 格式的图片');
      event.target.value = '';
      return;
    }
    if (file.size > AVATAR_MAX_SIZE) {
      setFileError('头像大小需在 2MB 以内');
      event.target.value = '';
      return;
    }
    setFileError(null);
    event.target.form?.requestSubmit();
  }

  async function handleSendCode() {
    if (!phone) {
      setCodeError('当前账号没有绑定手机号');
      return;
    }
    setSendingCode(true);
    const result = await sendCodeAction(phone);
    setSendingCode(false);
    if (!result.ok) {
      setCodeError(result.message ?? '验证码发送失败，请稍后再试');
      return;
    }
    setCodeError(null);
    setCountdown(COUNTDOWN_SECONDS);
    setCodeHint(result.devMode ? `开发态验证码：${result.devCode}` : '验证码已发送，请查收短信');
  }

  const avatarFeedback: ProfileState = fileError ? { error: fileError } : avatarNotice;

  return (
    <>
      <LoadingOverlay
        show={uploading || removing || savingNickname || resetting || sendingCode}
        text={uploading ? '正在上传头像…' : sendingCode ? '正在发送验证码…' : '正在保存，请稍候…'}
      />
      <section className={CARD}>
        <h2 className="m-0 text-[17px] font-bold text-ink">头像</h2>
        <p className="m-0 text-[14px] text-ink-3">支持 JPG / PNG / WebP / GIF，2MB 以内</p>
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-[28px] font-bold text-brand-700">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt="当前头像"
                width={160}
                height={160}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              (nickname.trim()[0] ?? '客')
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
                {uploading ? '上传中…' : '更换头像'}
              </button>
            </form>
            {avatar ? (
              <form action={removeAvatar}>
                <button type="submit" disabled={removing} className={BTN_GHOST}>
                  {removing ? '移除中…' : '移除'}
                </button>
              </form>
            ) : null}
          </div>
        </div>
        <Feedback state={avatarFeedback} />
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[17px] font-bold text-ink">用户名</h2>
        <p className="m-0 text-[14px] text-ink-3">2–20 个字，不能包含空格；会显示在顶栏和订单里</p>
        <form action={saveNickname} className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
          <label className="min-w-0 flex-1">
            <span className="sr-only">用户名</span>
            <input
              name="nickname"
              defaultValue={nicknameState.nickname ?? nickname}
              maxLength={20}
              autoComplete="nickname"
              placeholder="请输入用户名"
              className={INPUT}
            />
          </label>
          <button type="submit" disabled={savingNickname} className={BTN_PRIMARY}>
            {savingNickname ? '保存中…' : '保存'}
          </button>
        </form>
        <Feedback state={nicknameState} />
      </section>

      <section className={CARD}>
        <h2 className="m-0 text-[17px] font-bold text-ink">重置密码</h2>
        <p className="m-0 text-[14px] text-ink-3">
          验证码会发到绑定的手机号 {maskPhone(phone)}，请先获取验证码再设置新密码
        </p>
        <form action={resetPassword} className="mt-2 flex flex-col gap-3">
          <input type="hidden" name="phone" value={phone ?? ''} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">验证码</span>
              <input
                name="code"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="6 位验证码"
                className={`${INPUT} tracking-[2px] placeholder:tracking-normal`}
              />
            </label>
            <button
              type="button"
              onClick={handleSendCode}
              disabled={sendingCode || countdown > 0 || !phone}
              className={`${BTN_GHOST} sm:w-[148px]`}
            >
              {countdown > 0 ? `${countdown}s 后重发` : sendingCode ? '发送中…' : '获取验证码'}
            </button>
          </div>
          {codeError ? <p className="m-0 text-[14px] text-danger">{codeError}</p> : null}
          {codeHint ? <p className="m-0 text-[14px] text-ink-2">{codeHint}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="sr-only">新密码</span>
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                placeholder="新密码（8–32 位，字母 + 数字）"
                className={INPUT}
              />
            </label>
            <label className="min-w-0">
              <span className="sr-only">确认新密码</span>
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                placeholder="再输一次新密码"
                className={INPUT}
              />
            </label>
          </div>
          <div>
            <button type="submit" disabled={resetting} className={BTN_PRIMARY}>
              {resetting ? '提交中…' : '重置密码'}
            </button>
          </div>
        </form>
        <Feedback state={passwordState} />
      </section>
    </>
  );
}
