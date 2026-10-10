// @vitest-environment jsdom

import type { Issue } from '@paperclipai/shared';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PropertiesPanel } from '@/features/issues/detail/properties-panel';
import { initI18n, setLanguage } from '@/i18n';
import { ISSUE, mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const names = { a1: 'Executor Alpha', a2: 'Reviewer Alpha' };
const panel = (issue: unknown = ISSUE, over: Record<string, unknown> = {}) =>
  mount(
    <PropertiesPanel
      issue={issue as Issue}
      agentNames={names}
      projectName="Alpha"
      childIssues={[{ id: 'i5', identifier: 'TPS-5', title: 'Con một', status: 'done' }]}
      {...over}
    />,
  );

describe('PropertiesPanel chỉ đọc (S6.13)', () => {
  it('badge "Đã ép Done" chỉ khi được báo đã ép', () => {
    panel({ ...ISSUE, status: 'done' }, { forcedDone: true });
    expect(screen.getByText('Đã ép Done')).toBeTruthy();
    cleanup();
    panel({ ...ISSUE, status: 'done' });
    expect(screen.queryByText('Đã ép Done')).toBeNull();
  });

  it('hiển thị trạng thái, người làm, project, cha, con, blocked-by', () => {
    panel();
    const root = screen.getByTestId('properties-panel');
    expect(within(root).getByText('Đang duyệt')).toBeTruthy();
    expect(within(root).getByText('Executor Alpha')).toBeTruthy();
    expect(within(root).getByText('Alpha')).toBeTruthy();
    expect(within(root).getByText(/TPS-1/)).toBeTruthy();
    expect(within(root).getByText(/TPS-5/)).toBeTruthy();
    expect(within(root).getByText(/TPS-9/)).toBeTruthy();
  });

  it('hiển thị stage kèm người duyệt, vòng sửa n/5 và model', () => {
    panel();
    const root = screen.getByTestId('properties-panel');
    expect(within(root).getByText(/Reviewer Alpha/)).toBeTruthy();
    expect(within(root).getByText(/Owner duyệt/)).toBeTruthy();
    expect(within(root).getByText('2/5')).toBeTruthy();
    expect(within(root).getByText(/claude-sonnet-5/)).toBeTruthy();
    expect(within(root).getByText(/medium/)).toBeTruthy();
  });

  it('đọc runtime= của marker crew-model; không có runtime= thì là Claude', () => {
    panel({
      ...ISSUE,
      description: 'x\n\ncrew-model complexity=medium model=gpt-6-sol effort=high runtime=codex_local reason=việc vừa',
    });
    expect(within(screen.getByTestId('properties-panel')).getByText(/gpt-6-sol .*runtime Codex/)).toBeTruthy();
    cleanup();
    panel();
    expect(within(screen.getByTestId('properties-panel')).getByText(/claude-sonnet-5 .*runtime Claude/)).toBeTruthy();
  });

  it('loại Nghiên cứu theo nhãn research, còn lại là Code / Bug', () => {
    panel({ ...ISSUE, labels: [{ id: 'l1', name: 'research' }] });
    expect(within(screen.getByTestId('properties-panel')).getByText('Nghiên cứu')).toBeTruthy();
    cleanup();
    panel();
    expect(within(screen.getByTestId('properties-panel')).getByText('Code / Bug')).toBeTruthy();
  });

  it('không có control nhập nào', () => {
    panel();
    const root = screen.getByTestId('properties-panel');
    for (const role of ['combobox', 'textbox', 'checkbox', 'button', 'switch'] as const) {
      expect(within(root).queryAllByRole(role)).toEqual([]);
    }
  });

  it('thiếu dữ liệu Crew thì ghi không có thay vì lỗi', () => {
    panel({ ...ISSUE, description: null, executionPolicy: null, executionState: null, blockedBy: [], ancestors: [] });
    expect(screen.getByTestId('properties-panel')).toBeTruthy();
  });
});
