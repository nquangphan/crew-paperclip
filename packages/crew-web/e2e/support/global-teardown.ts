// Sau lượt: tắt stub cho mọi checkout e2e-* (để không còn marker nào khi xong), không đổi gì khác.
import { tier } from './env';
import { stub } from './stub';

export default async function globalTeardown(): Promise<void> {
  if (tier() === 't1') return;
  for (const key of stub.projectKeys()) stub.off(key);
}
