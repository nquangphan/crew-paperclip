// S0.2: chọn company. Chỉ company có cấu hình Crew (useCrewCompanies đã lọc); đổi thì về Tổng quan company mới.
import { useNavigate } from 'react-router-dom';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ds';
import { Building2, ChevronsUpDown } from '@/ds/icons';
import { useT } from '@/i18n';
import { useCompany } from '../hooks';
import { companyPath } from '../routes-util';

export function CompanySwitcher() {
  const { t } = useT();
  const navigate = useNavigate();
  const { company, companies } = useCompany();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label={t('company.switch')}>
          <Building2 aria-hidden />
          <span className="min-w-0 flex-1 truncate">{company.name}</span>
          <ChevronsUpDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={company.id}
          onValueChange={(id) => {
            const next = companies.find((c) => c.id === id);
            if (next && next.id !== company.id) navigate(companyPath(next.issuePrefix, 'dashboard'));
          }}
        >
          {companies.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
