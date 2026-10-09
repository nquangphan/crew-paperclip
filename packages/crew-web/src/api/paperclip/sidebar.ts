// Badge sidebar và thứ tự/sao project của người dùng.
import type { SidebarBadges, SidebarOrderPreference, UpsertSidebarOrderPreference } from '@paperclipai/shared';
import { call } from '../endpoints';

export const sidebarApi = {
  badges: (companyId: string): Promise<SidebarBadges> => call('sidebar.badges', { companyId }),
  preferences: (companyId: string): Promise<SidebarOrderPreference> => call('sidebar.preferences', { companyId }),
  savePreferences: (companyId: string, body: UpsertSidebarOrderPreference): Promise<SidebarOrderPreference> =>
    call('sidebar.savePreferences', { companyId }, { body }),
};

export const __endpoints = ['sidebar.badges', 'sidebar.preferences', 'sidebar.savePreferences'];
