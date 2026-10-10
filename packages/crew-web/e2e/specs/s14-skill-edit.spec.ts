// Sửa, tạo bản sửa được và xóa skill (S14.5–S14.7). T1 kiểm tác dụng trên Paperclip bằng API (skill, agent); phần
// cần máy thật (việc skill-sync/skill-remove, thư mục ~/.crew/skills, tên trùng skill Superpowers đã ghim) chỉ chạy
// ở T2 vì T1 không có máy báo về.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { tier } from '../support/env';
import { expect, test } from '../support/fixtures';
import {
  agentSkills,
  createSkill,
  dropSkill,
  type SkillLite,
  setAgentSkills,
  skillAgent,
  skillMarkdown,
  skillSlug,
} from '../support/r3x';

interface SyncState {
  skillId: string;
  machineId: string;
  kind: string;
  status: string;
  sha256: string | null;
}

const syncStates = async (api: Api, companyId: string, skillId: string) =>
  (await api.crewData<SyncState[]>('crew.skillSync', companyId)).filter((s) => s.skillId === skillId);

async function readSkillMd(api: Api, companyId: string, skillId: string): Promise<string> {
  const f = await api.get<{ content: string }>(`/api/companies/${companyId}/skills/${skillId}/files?path=SKILL.md`);
  return f.content;
}

/** Bấm "Đồng bộ" ở trang skill rồi chờ việc `skill-sync` của một máy xong; trả hash máy giữ. */
async function syncAndWait(page: Page, api: Api, companyId: string, skillId: string): Promise<string> {
  const syncButton = page.getByRole('button', { name: /^Đồng bộ( lại)?$/ }).first();
  await syncButton.click();
  await expect
    .poll(async () => (await syncStates(api, companyId, skillId)).find((s) => s.status === 'done')?.sha256 ?? null, {
      timeout: 120_000,
      intervals: [2_000],
    })
    .not.toBeNull();
  return (await syncStates(api, companyId, skillId)).find((s) => s.status === 'done')?.sha256 as string;
}

test('PW-S14-5 Sửa SKILL.md của skill tạo trên Paperclip: file đổi, có việc skill-sync mới @t1', async ({
  page,
  company,
  api,
}) => {
  const slug = skillSlug('e2e-edit');
  const skill = await createSkill(api, company.id, slug, 'Bản đầu');
  try {
    await page.goto(company.path(`skills/${skill.id}`));
    let firstHash: string | null = null;
    if (tier() !== 't1') firstHash = await syncAndWait(page, api, company.id, skill.id);

    const next = skillMarkdown(slug, 'Bản sửa trên web');
    await page.getByLabel('Nội dung SKILL.md').fill(next);
    await page.getByRole('button', { name: 'Lưu file', exact: true }).click();
    await expect(page.getByText('Đã lưu SKILL.md')).toBeVisible();

    expect(await readSkillMd(api, company.id, skill.id)).toBe(next);
    if (tier() !== 't1') {
      // Việc skill-sync mới xong với sha256 khác lần trước.
      await expect
        .poll(
          async () => {
            const done = (await syncStates(api, company.id, skill.id)).find((s) => s.status === 'done');
            return done?.sha256 && done.sha256 !== firstHash ? done.sha256 : null;
          },
          { timeout: 120_000, intervals: [2_000] },
        )
        .not.toBeNull();
    }
  } finally {
    await dropSkill(api, company.id, skill.id);
  }
});

test('PW-S14-5b Sửa thông tin skill: mô tả đổi trên Paperclip, tên và slug giữ nguyên @t1', async ({
  page,
  company,
  api,
}) => {
  const slug = skillSlug('e2e-info');
  const skill = await createSkill(api, company.id, slug);
  try {
    await page.goto(company.path(`skills/${skill.id}`));
    await page.getByRole('button', { name: 'Sửa thông tin' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mô tả').fill('Mô tả mới của ca e2e');
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(dialog).toBeHidden();
    const after = await api.get<SkillLite & { description: string }>(`/api/companies/${company.id}/skills/${skill.id}`);
    expect(after.description).toBe('Mô tả mới của ca e2e');
    expect(after.slug).toBe(slug);
    expect(after.name).toBe(slug);
  } finally {
    await dropSkill(api, company.id, skill.id);
  }
});

test('PW-S14-6 Skill chỉ đọc: không có nút sửa nội dung; "Tạo bản sửa được" chuyển agent sang khóa mới @t1', async ({
  page,
  company,
  api,
}) => {
  const skills = await api.get<SkillLite[]>(`/api/companies/${company.id}/skills`);
  const original = skills.find((s) => s.slug === 'first-task') ?? skills.find((s) => s.editable === false);
  test.skip(!original, 'Company không có skill chỉ đọc để tạo bản sửa');
  if (!original) return;
  const { id: workerId } = await skillAgent(api, company.id);
  const prior = (await agentSkills(api, workerId)).desiredSkills ?? [];
  let forkId: string | null = null;
  try {
    await setAgentSkills(api, workerId, [original.key]);
    await page.goto(company.path(`skills/${original.id}`));
    await expect(page.getByRole('button', { name: 'Lưu file', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Nội dung SKILL.md')).toHaveCount(0);

    await page.getByRole('button', { name: 'Tạo bản sửa được' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Chuyển 1 agent đang dùng sang bản mới')).toBeVisible();
    await dialog.getByRole('button', { name: 'Tạo bản sửa được', exact: true }).click();

    await expect(page.getByText('Bản gốc vẫn còn')).toBeVisible();
    const all = await api.get<SkillLite[]>(`/api/companies/${company.id}/skills`);
    const fork = all.find((s) => s.forkedFromSkillId === original.id);
    expect(fork, 'skill bản sửa').toBeTruthy();
    if (!fork) return;
    forkId = fork.id;
    expect(fork.sourceType).toBe('local_path');
    expect(fork.key).not.toBe(original.key);
    const desired = (await agentSkills(api, workerId)).desiredSkills ?? [];
    expect(desired).toContain(fork.key);
    expect(desired).not.toContain(original.key);
    // Bản sửa được sửa nội dung: có ô Nội dung SKILL.md.
    await expect(page.getByLabel('Nội dung SKILL.md')).toBeVisible();
  } finally {
    await setAgentSkills(api, workerId, prior).catch(() => undefined);
    if (forkId) await dropSkill(api, company.id, forkId);
  }
});

test('PW-S14-5c Đổi name: thành tên skill Superpowers đã ghim: chặn, không gọi API ghi file', async ({
  page,
  company,
  api,
}) => {
  test.skip(tier() === 't1', 'T1 không có máy báo danh sách skill Superpowers đã ghim');
  const slug = skillSlug('e2e-clash');
  const skill = await createSkill(api, company.id, slug);
  try {
    const writes: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes('/files')) writes.push(req.url());
    });
    await page.goto(company.path(`skills/${skill.id}`));
    await page.getByLabel('Nội dung SKILL.md').fill(skillMarkdown('brainstorming', 'trùng tên ghim'));
    await expect(page.getByText('Tên brainstorming trùng skill Superpowers đã ghim, không lưu được')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lưu file', exact: true })).toBeDisabled();
    expect(writes).toEqual([]);
    expect(await readSkillMd(api, company.id, skill.id)).toContain(`name: ${slug}`);
  } finally {
    await dropSkill(api, company.id, skill.id);
  }
});

test('PW-S14-7 Xóa skill đang bật cho agent: gỡ khỏi agent, 404, không còn bản chép trên máy @t1', async ({
  page,
  company,
  api,
}) => {
  const slug = skillSlug('e2e-del');
  const skill = await createSkill(api, company.id, slug);
  const { id: workerId } = await skillAgent(api, company.id);
  const prior = (await agentSkills(api, workerId)).desiredSkills ?? [];
  const macCopy = path.join(os.homedir(), '.crew', 'skills', company.id, slug);
  try {
    await setAgentSkills(api, workerId, [...prior, skill.key]);
    await page.goto(company.path(`skills/${skill.id}`));
    if (tier() !== 't1') {
      await syncAndWait(page, api, company.id, skill.id);
      await expect.poll(() => existsSync(macCopy), { timeout: 60_000 }).toBe(true);
    }

    await page.getByRole('button', { name: 'Xóa skill', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Agent đang bật skill:')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Xóa skill', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox').fill(slug);
    await dialog.getByRole('button', { name: 'Xóa skill', exact: true }).click();

    await expect(page.getByText(`Đã xóa skill ${slug}`)).toBeVisible();
    await expect(page).toHaveURL(/\/skills$/);

    const gone = await api.raw('GET', `/api/companies/${company.id}/skills/${skill.id}`);
    expect(gone.status).toBe(404);
    expect(((await agentSkills(api, workerId)).desiredSkills ?? []).includes(skill.key)).toBe(false);
    const list = await api.get<SkillLite[]>(`/api/companies/${company.id}/skills`);
    expect(list.some((s) => s.id === skill.id)).toBe(false);
    if (tier() !== 't1') {
      await expect.poll(() => existsSync(macCopy), { timeout: 120_000, intervals: [2_000] }).toBe(false);
      await expect.poll(async () => (await syncStates(api, company.id, skill.id)).length, { timeout: 60_000 }).toBe(0);
    }
  } finally {
    await setAgentSkills(api, workerId, prior).catch(() => undefined);
    await dropSkill(api, company.id, skill.id);
  }
});
