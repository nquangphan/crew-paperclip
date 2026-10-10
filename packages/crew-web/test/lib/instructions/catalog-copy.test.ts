// Bản chép phần model của bảng runtime (server/src/crew/model-policy.ts, plugin src/runtimes/catalog.ts) ở crew-web
// phải trùng hai bản kia.
import { describe, expect, it } from 'vitest';
import { CREW_CODEX_REVIEWER_MODEL, CREW_RUNTIME_MODELS } from '@/lib/instructions';
import * as server from '../../../../../server/src/crew/model-policy';
import * as plugin from '../../../../crew-plugin/src/runtimes/catalog';

describe('bản chép catalog model ở crew-web', () => {
  for (const [name, source] of [
    ['server', server],
    ['plugin', plugin],
  ] as const) {
    it(`khớp model và key effort của bản ${name}`, () => {
      const want = Object.fromEntries(
        Object.entries(source.CREW_RUNTIME_CATALOG).map(([runtime, spec]) => [
          runtime,
          { effortKey: spec.effortKey, models: spec.models },
        ]),
      );
      expect(CREW_RUNTIME_MODELS).toEqual(want);
      expect(CREW_CODEX_REVIEWER_MODEL).toEqual(source.CREW_CODEX_REVIEWER_MODEL);
    });
  }

  it('cột Claude vẫn là CREW_MODELS cũ của server', async () => {
    const { CREW_MODELS } = await import('@/lib/instructions');
    expect(new Set(CREW_MODELS)).toEqual(server.CREW_ALLOWED_MODELS);
  });
});
