// Ô chọn dùng chung của trang Cài đặt model: select theo danh sách chuỗi và select effort (có hoặc không có "Không đặt").
import type { ModelEffort } from '@/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ds';
import { useT } from '@/i18n';
import { EFFORTS } from './model-draft';

/** Radix Select không nhận giá trị rỗng cho một mục, nên "không có" đi qua giá trị này. */
export const NONE = '__none__';

export interface Choice {
  value: string;
  label: string;
}

interface ChoiceSelectProps {
  id?: string;
  label: string;
  value: string;
  choices: readonly Choice[];
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}

/** Select một chọn; giá trị hiện tại không có trong `choices` (ví dụ model đã gỡ) vẫn hiện để người dùng thấy chỗ sai. */
export function ChoiceSelect({ id, label, value, choices, onChange, invalid, disabled }: ChoiceSelectProps) {
  const known = choices.some((c) => c.value === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} aria-invalid={invalid ? true : undefined} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {known ? null : <SelectItem value={value}>{value}</SelectItem>}
        {choices.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface EffortSelectProps {
  label: string;
  value: ModelEffort | null;
  onChange: (value: ModelEffort | null) => void;
  /** Cho chọn "Không đặt" (vai không bắt buộc effort). */
  allowNone?: boolean;
  invalid?: boolean;
  disabled?: boolean;
}

export function EffortSelect({ label, value, onChange, allowNone, invalid, disabled }: EffortSelectProps) {
  const { t } = useT('settings');
  const choices: Choice[] = [
    ...(allowNone || value === null ? [{ value: NONE, label: t('models.effort.none') }] : []),
    ...EFFORTS.map((e) => ({ value: e, label: e })),
  ];
  return (
    <ChoiceSelect
      label={label}
      value={value ?? NONE}
      choices={choices}
      invalid={invalid}
      disabled={disabled}
      onChange={(v) => onChange(v === NONE ? null : (v as ModelEffort))}
    />
  );
}
