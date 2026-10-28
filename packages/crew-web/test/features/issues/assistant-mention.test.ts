import { describe, expect, it } from 'vitest';
import { toAssistantMention } from '@/features/issues/detail/assistant-mention';

const A = { id: '11111111-1111-4111-8111-111111111111' };
const LINK = `[@Trợ Lý](agent://${A.id})`;

describe('toAssistantMention', () => {
  it.each([
    ['@tro-ly làm đi', `${LINK} làm đi`],
    ['@TRO-LY làm đi', `${LINK} làm đi`],
    ['@Trợ Lý vào làm đi', `${LINK} vào làm đi`],
    ['@trợ lý', LINK],
    ['ê @tro-ly, xem giúp', `ê ${LINK}, xem giúp`],
    ['xong chưa @tro-ly?', `xong chưa ${LINK}?`],
    ['(@tro-ly) xem', `(${LINK}) xem`],
    ['dòng 1\n@tro-ly dòng 2', `dòng 1\n${LINK} dòng 2`],
    ['@tro-ly. Hết', `${LINK}. Hết`],
    ['@tro-ly và @Trợ Lý', `${LINK} và ${LINK}`],
  ])('%s → link tới Trợ Lý', (input, body) => {
    expect(toAssistantMention(input, A)).toEqual({ body, mentioned: true, missing: false });
  });

  it.each([
    'email@tro-ly.vn',
    'gửi @tro-ly.vn',
    '@tro-lyx',
    '@tro-ly-2',
    'x@tro-ly',
    '`@tro-ly` trong inline code',
    '```\n@tro-ly trong code block\n```',
    '~~~js\nconst a = "@tro-ly";\n~~~',
    'đã có [@tro-ly](https://example.com) rồi',
    `đã có ${LINK} rồi`,
    'không tag gì',
  ])('%s → không đổi', (input) => {
    expect(toAssistantMention(input, A)).toEqual({ body: input, mentioned: false, missing: false });
  });

  it('chuẩn hóa NFC: chữ gõ dạng NFD vẫn khớp', () => {
    const nfd = '@Trợ Lý giúp'.normalize('NFD');
    expect(nfd).not.toBe('@Trợ Lý giúp');
    expect(toAssistantMention(nfd, A)).toEqual({ body: `${LINK} giúp`, mentioned: true, missing: false });
  });

  it('chỉ đổi phần ngoài code: tag sau code block vẫn đổi', () => {
    const input = '```\n@tro-ly\n```\n@tro-ly làm';
    expect(toAssistantMention(input, A).body).toBe(`\`\`\`\n@tro-ly\n\`\`\`\n${LINK} làm`);
  });

  it('không có Trợ Lý: giữ nguyên chữ và báo missing', () => {
    expect(toAssistantMention('@tro-ly làm đi', null)).toEqual({
      body: '@tro-ly làm đi',
      mentioned: false,
      missing: true,
    });
    expect(toAssistantMention('không tag', null)).toEqual({ body: 'không tag', mentioned: false, missing: false });
  });
});
