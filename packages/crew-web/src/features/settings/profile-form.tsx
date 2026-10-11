// Hồ sơ người dùng (S18.1): tên hiển thị và ảnh đại diện. Ảnh upload thành asset rồi PATCH /api/auth/profile.

import type { UpdateCurrentUserProfile } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import { useCompany, useMe } from '@/app/hooks';
import { Alert, Avatar, AvatarFallback, AvatarImage, Button, Field, Input, MutedText } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';

export function ProfileForm() {
  const { t } = useT('settings');
  const { company } = useCompany();
  const me = useMe();
  // Upload ảnh đi qua route asset của company, mà viewer (kể cả Phòng Marketing) bị chặn ghi ở đó: chỉ cho đổi tên.
  const { readOnly } = useCompanyAccess();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.name ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async (change: { removeImage: boolean }) => {
      const body: UpdateCurrentUserProfile = { name: name.trim(), image: undefined };
      if (readOnly) return api.profile.update(body);
      if (change.removeImage) body.image = null;
      else if (file) body.image = (await api.profile.uploadImage(company.id, file)).contentPath;
      return api.profile.update(body);
    },
    onSuccess: () => {
      setSaved(true);
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
    onMutate: () => setSaved(false),
  });
  const blank = name.trim() === '';

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blank && !save.isPending) save.mutate({ removeImage: false });
      }}
    >
      <div className="flex items-center gap-3">
        <Avatar>
          {me.image ? <AvatarImage src={me.image} alt="" /> : null}
          <AvatarFallback>{(me.name ?? me.email ?? '?').slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        {me.email ? <MutedText>{me.email}</MutedText> : null}
      </div>
      <Field label={t('profile.name')} htmlFor="profile-name">
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {readOnly ? null : (
        <Field label={t('profile.image')} hint={t('profile.imageHint')} htmlFor="profile-image">
          <Input
            id="profile-image"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      )}
      {save.error ? (
        <Alert variant="destructive" title={t('profile.saveFailed')}>
          {save.error.message}
        </Alert>
      ) : null}
      {saved ? <Alert variant="info" title={t('profile.saved')} /> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={blank || save.isPending}>
          {t('profile.save')}
        </Button>
        {me.image && !readOnly ? (
          <Button
            type="button"
            variant="outline"
            disabled={blank || save.isPending}
            onClick={() => save.mutate({ removeImage: true })}
          >
            {t('profile.removeImage')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
