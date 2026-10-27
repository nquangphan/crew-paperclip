// Phần 3 của trang Cài đặt model: model và effort mặc định của từng vai. Runtime của vai cố định (chỉ đọc).
import type { ModelSettings, ModelSettingsIssue } from '@/api';
import { Badge, InlineError, MutedText, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds';
import { useT } from '@/i18n';
import { ChoiceSelect, EffortSelect } from './fields';
import { EFFORT_REQUIRED_ROLES, errorAt, path, ROLE_RUNTIME, ROLES, setRole } from './model-draft';

interface RolesSectionProps {
  settings: ModelSettings;
  issues: readonly ModelSettingsIssue[];
  onChange: (next: ModelSettings) => void;
}

export function RolesSection({ settings, issues, onChange }: RolesSectionProps) {
  const { t } = useT('settings');
  return (
    <>
      <MutedText>{t('models.roles.hint')}</MutedText>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('models.roles.role')}</TableHead>
            <TableHead>{t('models.roles.runtime')}</TableHead>
            <TableHead>{t('models.roles.model')}</TableHead>
            <TableHead>{t('models.roles.effort')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROLES.map((role) => {
            const runtime = ROLE_RUNTIME[role];
            const spec = settings.catalog[runtime];
            const cell = settings.roles[role];
            const modelError = errorAt(issues, `${path.role(role)}.model`);
            const effortError = errorAt(issues, `${path.role(role)}.effort`);
            const rowError = errorAt(issues, path.role(role));
            return (
              <TableRow key={role} data-role={role}>
                <TableCell>
                  <code>{role}</code>
                  {role === 'reviewer-root' ? <MutedText>{t('models.roles.rootNote')}</MutedText> : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{runtime}</Badge>
                </TableCell>
                <TableCell>
                  <ChoiceSelect
                    label={t('models.roles.modelOf', { role })}
                    value={cell.model}
                    choices={Object.keys(spec.models).map((id) => ({ value: id, label: id }))}
                    invalid={modelError !== undefined || rowError !== undefined}
                    onChange={(model) => onChange(setRole(settings, role, { model }))}
                  />
                  {modelError ? <InlineError>{modelError}</InlineError> : null}
                  {rowError && !modelError && !effortError ? <InlineError>{rowError}</InlineError> : null}
                </TableCell>
                <TableCell>
                  {spec.effortKey === null ? (
                    <MutedText>{t('models.roles.noEffort')}</MutedText>
                  ) : (
                    <EffortSelect
                      label={t('models.roles.effortOf', { role })}
                      value={cell.effort}
                      allowNone={!EFFORT_REQUIRED_ROLES.has(role)}
                      invalid={effortError !== undefined}
                      onChange={(effort) => onChange(setRole(settings, role, { effort }))}
                    />
                  )}
                  {effortError ? <InlineError>{effortError}</InlineError> : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
