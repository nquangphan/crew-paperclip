import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPolicyConfig } from "./policy-config.mjs";

const COMPANY = "5befeb1a-1578-4656-b913-267494592e53";
const REVIEWER = "11111111-1111-4111-8111-111111111111";
const INTEGRATOR = "22222222-2222-4222-8222-222222222222";

test("ghi entry company, giữ company khác trong file cũ", () => {
  const existing = JSON.stringify({ companies: { other: { reviewerAgentId: "a", integratorAgentId: "b", ownerUserId: "c" } } });
  const out = buildPolicyConfig(existing, COMPANY, {
    reviewerAgentId: REVIEWER,
    integratorAgentId: INTEGRATOR,
    ownerUserId: "owner-1",
  });
  assert.deepEqual(out, {
    companies: {
      other: { reviewerAgentId: "a", integratorAgentId: "b", ownerUserId: "c" },
      [COMPANY]: { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR, ownerUserId: "owner-1" },
    },
  });
});

test("không có file cũ thì tạo mới", () => {
  const out = buildPolicyConfig(null, COMPANY, { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR, ownerUserId: "o" });
  assert.deepEqual(Object.keys(out.companies), [COMPANY]);
});

test("từ chối reviewer trùng integrator, id không phải uuid, owner rỗng", () => {
  const ok = { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR, ownerUserId: "o" };
  assert.throws(() => buildPolicyConfig(null, COMPANY, { ...ok, integratorAgentId: REVIEWER }), /khác nhau/);
  assert.throws(() => buildPolicyConfig(null, COMPANY, { ...ok, reviewerAgentId: "abc" }), /uuid/);
  assert.throws(() => buildPolicyConfig(null, COMPANY, { ...ok, ownerUserId: " " }), /ownerUserId/);
  assert.throws(() => buildPolicyConfig(null, "", ok), /companyId/);
});

test("từ chối file cũ hỏng thay vì ghi đè", () => {
  const ok = { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR, ownerUserId: "o" };
  assert.throws(() => buildPolicyConfig("{oops", COMPANY, ok), /JSON/);
  assert.throws(() => buildPolicyConfig("{}", COMPANY, ok), /companies/);
});
