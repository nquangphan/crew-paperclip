# Fixture render `AGENTS.md`

`rendered/*.md` sinh bằng script gốc của fork `crew/agents/render-instructions.mjs` (chạy từ gốc fork). Test
`render.test.ts` so bản port TypeScript với các file này và chạy lại script để chắc fixture còn khớp template hiện tại.
Template `crew/agents/*.md` đổi thì sinh lại:

```sh
A=11111111-1111-4111-8111-111111111111
E1=22222222-2222-4222-8222-222222222222
E2=33333333-3333-4333-8333-333333333333
B1=44444444-4444-4444-8444-444444444444
D=packages/crew-web/test/lib/instructions/__fixtures__/rendered
gen() { node crew/agents/render-instructions.mjs "$@" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).content))'; }
gen assistant crew/agents/assistant.md $A "$E1,$E2" > $D/assistant.md
gen assistant crew/agents/assistant.md $A "$E1" "$B1" > $D/assistant-bmad.md
for r in executor reviewer integrator bmad; do gen $r crew/agents/$r.md $A > $D/$r.md; done
```
