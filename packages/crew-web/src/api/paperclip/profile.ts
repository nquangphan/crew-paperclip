// Hồ sơ người dùng (S18.1): tên, ảnh đại diện. Ảnh upload qua server/src/routes/assets.ts:115 rồi PATCH profile.
import type { CurrentUserProfile, UpdateCurrentUserProfile } from '@paperclipai/shared';
import { call } from '../endpoints';

export interface UploadedAsset {
  assetId: string;
  contentPath: string;
  [key: string]: unknown;
}

export const profileApi = {
  update: (input: UpdateCurrentUserProfile): Promise<CurrentUserProfile> =>
    call('auth.updateProfile', {}, { body: input }),
  uploadImage: (companyId: string, file: File, namespace = 'profile'): Promise<UploadedAsset> => {
    const form = new FormData();
    form.append('namespace', namespace);
    form.append('file', file);
    return call('assets.uploadImage', { companyId }, { form });
  },
};

export const __endpoints = ['assets.uploadImage', 'auth.updateProfile'];
