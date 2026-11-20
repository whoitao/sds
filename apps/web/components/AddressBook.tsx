'use client';

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  deleteAddressAction,
  saveAddressAction,
  setDefaultAddressAction,
  type AddressActionState
} from '@/app/(site)/addresses/actions';
import type { AddressItem } from '@/lib/api';
import type { RegionTreeNode } from '@/lib/regions';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useMessages } from '@/components/LocaleProvider';
import { formatMessage } from '@/lib/i18n/config';

const PHONE_RULE = /^1[3-9]\d{9}$/;
const HIDDEN_REGION_NAMES = new Set(['市辖区', '省直辖县级行政区划', '自治区直辖县级行政区划']);

const INPUT_BASE =
  'h-[54px] w-full rounded-[14px] border-[1.5px] border-line bg-card-soft px-4 text-[17px] text-ink outline-none transition focus:border-2 focus:border-brand-500 focus:bg-card focus:ring-4 focus:ring-brand-500/15 placeholder:text-ink-3';

type Feedback = { type: 'ok' | 'error'; text: string };

/** 展示用地址：直辖市自动跳过「市辖区」这类占位层级 */
function regionLabel(item: AddressItem) {
  return [item.province, item.city, item.district]
    .filter((name): name is string => Boolean(name) && !HIDDEN_REGION_NAMES.has(name as string))
    .join(' ');
}

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
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    default:
      return null;
  }
}

export function AddressForm({
  item,
  isFirst,
  regionTree,
  onClose,
  onSaved
}: {
  item: AddressItem | null;
  isFirst: boolean;
  regionTree: RegionTreeNode[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const m = useMessages();
  const t = m.address;
  const [state, formAction, saving] = useActionState<AddressActionState, FormData>(
    saveAddressAction,
    {}
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [provinceCode, setProvinceCode] = useState(item?.provinceCode ?? '');
  const [cityCode, setCityCode] = useState(item?.cityCode ?? '');
  const [districtCode, setDistrictCode] = useState(item?.districtCode ?? '');

  const cities = regionTree.find((province) => province.code === provinceCode)?.children ?? [];
  const districts = cities.find((city) => city.code === cityCode)?.children ?? [];

  useEffect(() => {
    if (state.ok) onSaved(state.message ?? t.savedFallback);
  }, [state, onSaved, t]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const nextErrors: Record<string, string> = {};

    if (!String(data.get('contactName') ?? '').trim()) nextErrors.contactName = t.contactRequired;
    if (!PHONE_RULE.test(String(data.get('contactPhone') ?? '').trim())) {
      nextErrors.contactPhone = t.phoneInvalid;
    }
    if (!provinceCode || !cityCode || !districtCode) {
      nextErrors.region = t.regionRequired;
    }
    if (String(data.get('detail') ?? '').trim().length < 5) {
      nextErrors.detail = t.detailTooShort;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) event.preventDefault();
  }

  return (
    <section className="rounded-3xl bg-card p-6 shadow-auth sm:p-7">
      <LoadingOverlay show={saving} text={t.loadingSave} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[24px] font-extrabold text-brand-700">
          {item ? t.editTitle : t.newTitle}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-xl px-4 text-[16px] font-semibold text-ink-2 transition-colors hover:bg-segment hover:text-ink"
        >
          {t.collapse}
        </button>
      </div>

      <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="id" value={item?.id ?? ''} />

        {state.error ? (
          <p className="rounded-[10px] bg-danger-soft px-4 py-2.5 text-[16px] text-danger">
            {state.error}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[16px] font-bold text-ink">
            {t.contactName}
            <input
              name="contactName"
              defaultValue={item?.contactName ?? ''}
              maxLength={20}
              placeholder={t.contactPlaceholder}
              onChange={() => setErrors((prev) => ({ ...prev, contactName: '' }))}
              aria-invalid={Boolean(errors.contactName)}
              className={`${INPUT_BASE} font-normal ${errors.contactName ? 'border-danger' : ''}`}
            />
            {errors.contactName ? <span className="text-[15px] font-normal text-danger">{errors.contactName}</span> : null}
          </label>

          <label className="flex flex-col gap-1.5 text-[16px] font-bold text-ink">
            {t.phone}
            <input
              name="contactPhone"
              type="tel"
              inputMode="numeric"
              defaultValue={item?.contactPhone ?? ''}
              maxLength={11}
              placeholder={t.phonePlaceholder}
              onChange={() => setErrors((prev) => ({ ...prev, contactPhone: '' }))}
              aria-invalid={Boolean(errors.contactPhone)}
              className={`${INPUT_BASE} font-normal ${errors.contactPhone ? 'border-danger' : ''}`}
            />
            {errors.contactPhone ? <span className="text-[15px] font-normal text-danger">{errors.contactPhone}</span> : null}
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[16px] font-bold text-ink">{t.region}</span>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              name="provinceCode"
              value={provinceCode}
              onChange={(event) => {
                setProvinceCode(event.target.value);
                setCityCode('');
                setDistrictCode('');
                setErrors((prev) => ({ ...prev, region: '' }));
              }}
              className={INPUT_BASE}
            >
              <option value="">{t.provincePlaceholder}</option>
              {regionTree.map((province) => (
                <option key={province.code} value={province.code}>
                  {province.name}
                </option>
              ))}
            </select>

            <select
              name="cityCode"
              value={cityCode}
              disabled={!provinceCode}
              onChange={(event) => {
                setCityCode(event.target.value);
                setDistrictCode('');
                setErrors((prev) => ({ ...prev, region: '' }));
              }}
              className={`${INPUT_BASE} disabled:cursor-not-allowed disabled:bg-segment disabled:text-ink-3`}
            >
              <option value="">{t.cityPlaceholder}</option>
              {cities.map((city) => (
                <option key={city.code} value={city.code}>
                  {city.name}
                </option>
              ))}
            </select>

            <select
              name="districtCode"
              value={districtCode}
              disabled={!cityCode}
              onChange={(event) => {
                setDistrictCode(event.target.value);
                setErrors((prev) => ({ ...prev, region: '' }));
              }}
              className={`${INPUT_BASE} disabled:cursor-not-allowed disabled:bg-segment disabled:text-ink-3`}
            >
              <option value="">{t.districtPlaceholder}</option>
              {districts.map((district) => (
                <option key={district.code} value={district.code}>
                  {district.name}
                </option>
              ))}
            </select>
          </div>
          {regionTree.length === 0 ? (
            <span className="text-[15px] text-danger">{t.regionLoadFailed}</span>
          ) : null}
          {errors.region ? <span className="text-[15px] text-danger">{errors.region}</span> : null}
        </div>

        <label className="flex flex-col gap-1.5 text-[16px] font-bold text-ink">
          {t.detail}
          <textarea
            name="detail"
            rows={2}
            defaultValue={item?.detail ?? ''}
            maxLength={200}
            placeholder={t.detailPlaceholder}
            onChange={() => setErrors((prev) => ({ ...prev, detail: '' }))}
            aria-invalid={Boolean(errors.detail)}
            className={`${INPUT_BASE} h-auto resize-y py-3 font-normal leading-relaxed ${
              errors.detail ? 'border-danger' : ''
            }`}
          />
          {errors.detail ? <span className="text-[15px] font-normal text-danger">{errors.detail}</span> : null}
        </label>

        <label className="flex flex-col gap-1.5 text-[16px] font-bold text-ink">
          {t.remark}
          <input
            name="remark"
            defaultValue={item?.remark ?? ''}
            maxLength={100}
            placeholder={t.remarkPlaceholder}
            className={`${INPUT_BASE} font-normal`}
          />
        </label>

        {item ? null : (
          <label className="flex items-center gap-2.5 text-[16px] text-ink-2">
            <input
              type="checkbox"
              name="isDefault"
              defaultChecked={isFirst}
              className="h-[18px] w-[18px] accent-brand-700"
            />
            {t.setDefaultField}
          </label>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="h-[54px] rounded-[14px] bg-primary px-7 text-[18px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-segment disabled:text-ink-3"
          >
            {saving ? m.common.saving : item ? t.saveEdit : t.saveNew}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[54px] rounded-[14px] border-[1.5px] border-line px-6 text-[17px] font-semibold text-ink-2 transition-colors hover:border-brand-200 hover:text-brand-700"
          >
            {m.common.cancel}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function AddressBook({
  items,
  regionTree
}: {
  items: AddressItem[];
  regionTree: RegionTreeNode[];
}) {
  const m = useMessages();
  const t = m.address;
  const [editing, setEditing] = useState<{ item: AddressItem | null } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmItem = items.find((item) => item.id === confirmId) ?? null;

  const handleSaved = useCallback((message: string) => {
    setEditing(null);
    setFeedback({ type: 'ok', text: message });
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // 删除确认弹窗：打开时把焦点移入弹窗、支持 Esc 关闭，并锁定背景滚动
  useEffect(() => {
    if (!confirmId) return;
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setConfirmId(null);
    }
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [confirmId]);

  function runAction(
    id: string,
    action: (id: string) => Promise<AddressActionState>,
    fallbackMessage: string
  ) {
    setBusyId(id);
    startTransition(async () => {
      const result = await action(id);
      setBusyId(null);
      if (result.ok) {
        setConfirmId(null);
        setFeedback({ type: 'ok', text: result.message ?? fallbackMessage });
      } else {
        setConfirmId(null);
        setFeedback({ type: 'error', text: result.error ?? t.actionFailed });
      }
    });
  }

  function openCreate() {
    setFeedback(null);
    setConfirmId(null);
    setEditing({ item: null });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <LoadingOverlay show={pending} text={t.loadingUpdate} />
      {feedback ? (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-[16px] ${
            feedback.type === 'ok' ? 'bg-brand-50 text-brand-700' : 'bg-danger-soft text-danger'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="shrink-0 text-[15px] underline"
          >
            {t.gotIt}
          </button>
        </div>
      ) : null}

      {editing ? (
        <AddressForm
          key={editing.item?.id ?? 'new'}
          item={editing.item}
          isFirst={items.length === 0}
          regionTree={regionTree}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {items.length === 0 && !editing ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-line bg-card px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Icon name="pin" className="h-7 w-7" />
          </span>
          <b className="text-[22px] text-ink">{t.emptyTitle}</b>
          <p className="text-[17px] text-ink-2">{t.emptyDesc}</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-2 h-[52px] rounded-full bg-primary px-7 text-[18px] font-bold text-white transition-colors hover:bg-primary-hover"
          >
            {t.add}
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-card shadow-perk">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon name="pin" className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <b className="text-[17px] text-ink">{item.contactName}</b>
                    <span className="text-[15px] text-ink-2">{item.contactPhone}</span>
                    {item.isDefault ? (
                      <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[13px] font-bold text-brand-700">
                        {t.defaultBadge}
                      </span>
                    ) : null}
                  </div>

                  <p className="m-0 mt-1 break-words text-[15px] leading-[1.55] text-ink-2">
                    {regionLabel(item)} {item.detail}
                  </p>
                  {item.remark ? (
                    <p className="m-0 mt-0.5 break-words text-[14px] leading-[1.5] text-ink-3">
                      {formatMessage(t.remarkPrefix, { text: item.remark })}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto sm:shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null);
                    setConfirmId(null);
                    setEditing({ item });
                  }}
                  className="h-9 rounded-lg px-3 text-[16px] font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                >
                  {m.common.edit}
                </button>
                {item.isDefault ? null : (
                  <button
                    type="button"
                    onClick={() => runAction(item.id, setDefaultAddressAction, t.defaultSet)}
                    disabled={busyId === item.id}
                    className="h-9 rounded-lg px-3 text-[16px] font-semibold text-ink-2 transition-colors hover:bg-segment hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.setDefault}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmId(item.id)}
                  className="ml-auto h-9 rounded-lg px-3 text-[16px] text-danger transition-colors hover:bg-danger-soft"
                >
                  {m.common.delete}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {items.length > 0 && !editing ? (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={openCreate}
            className="flex h-[52px] items-center gap-2 rounded-full bg-primary px-[22px] text-[18px] font-bold text-white transition-colors hover:bg-primary-hover"
          >
            <Icon name="plus" className="h-5 w-5" />
            {t.add}
          </button>
        </div>
      ) : null}

      {confirmItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-address-title"
            aria-describedby="delete-address-desc"
            className="w-full max-w-[420px] rounded-[18px] border border-line bg-card p-5 shadow-perk sm:p-6"
          >
            <h2 id="delete-address-title" className="m-0 text-[19px] font-extrabold text-ink">
              {t.deleteTitle}
            </h2>
            <div id="delete-address-desc" className="mt-2">
              <p className="m-0 break-words text-[15px] leading-[1.6] text-ink-2">
                <b className="text-[16px] text-ink">{confirmItem.contactName}</b>
                {confirmItem.contactPhone ? ` · ${confirmItem.contactPhone}` : ''}
              </p>
              <p className="m-0 mt-1 break-words text-[15px] leading-[1.6] text-ink-2">
                {regionLabel(confirmItem)} {confirmItem.detail}
              </p>
              <p className="m-0 mt-2 text-[13px] leading-[1.5] text-ink-3">{t.deleteIrreversible}</p>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setConfirmId(null)}
                className="h-11 rounded-full border-[1.5px] border-line px-5 text-[16px] font-semibold text-ink-2 transition-colors hover:border-brand-200 hover:text-brand-700"
              >
                {m.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => runAction(confirmItem.id, deleteAddressAction, t.deleted)}
                disabled={busyId === confirmItem.id}
                className="h-11 rounded-full bg-danger px-5 text-[16px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyId === confirmItem.id ? t.deleting : t.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
