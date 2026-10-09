// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/api';
import { useResearchLabelId } from '@/features/issues/new/use-create-request';
import { mockServer } from '../../app/fetch-mock';

const LABELS = [
  { id: 'l-bug', name: 'bug', color: '#f00' },
  { id: 'l-research', name: 'research', color: '#00f' },
];

describe('useResearchLabelId', () => {
  it('dùng chung cache nhãn của company, sự kiện yêu cầu không làm tải lại nhãn', async () => {
    const s = mockServer({ 'GET /api/companies/c1/labels': { body: LABELS } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useResearchLabelId('c1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBe('l-research'));
    expect(qc.getQueryData(queryKeys.labels('c1'))).toEqual(LABELS);
    await act(() => qc.invalidateQueries({ queryKey: queryKeys.issues('c1') }));
    const gets = s.calls.filter((c) => c.url.endsWith('/companies/c1/labels'));
    expect(gets).toHaveLength(1);
  });
});
