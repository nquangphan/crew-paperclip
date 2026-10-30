// Hàng phím phụ cho điện thoại: bàn phím ảo thiếu Esc, Tab, mũi tên và Ctrl, mà CLI như Claude Code cần.
import { useEffect, useState } from 'react';
import { TerminalKeyRow } from '@/ds';
import { useT } from '@/i18n';

export const ACCESSORY_KEYS = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Shift+Tab', data: '\x1b[Z' },
  { label: 'Enter', data: '\r' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '→', data: '\x1b[C' },
  { label: '←', data: '\x1b[D' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: 'Ctrl+L', data: '\x0c' },
  { label: 'Ctrl+R', data: '\x12' },
] as const;

const COARSE = '(pointer: coarse)';
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Màn cảm ứng (con trỏ thô): mới hiện hàng phím phụ. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => hasMatchMedia() && window.matchMedia(COARSE).matches);
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mql = window.matchMedia(COARSE);
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

export function AccessoryKeys({ send }: { send: (data: string) => void }) {
  const { t } = useT('terminal');
  return <TerminalKeyRow keys={ACCESSORY_KEYS} onKey={send} label={t('keysLabel')} />;
}
