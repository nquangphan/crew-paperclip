# Fixture render `AGENTS.md`

`rendered/*.md` sinh bằng script gốc của fork `crew/agents/render-instructions.mjs` (chạy từ gốc fork). Test
`render.test.ts` so bản port TypeScript với các file này và chạy lại script để chắc fixture còn khớp template hiện tại.
Template `crew/agents/*.md` hoặc script đổi thì sinh lại (viết `${E2}:codex_local` có ngoặc nhọn: zsh hiểu `$E2:c` là
modifier):

```sh
A=11111111-1111-4111-8111-111111111111
E1=22222222-2222-4222-8222-222222222222
E2=33333333-3333-4333-8333-333333333333
B1=44444444-4444-4444-8444-444444444444
E3=55555555-5555-4555-8555-555555555555
R1=66666666-6666-4666-8666-666666666666
D=packages/crew-web/test/lib/instructions/__fixtures__/rendered
gen() { node crew/agents/render-instructions.mjs "$@" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).content))'; }
gen assistant crew/agents/assistant.md $A "$E1,$E2" > $D/assistant.md
gen assistant crew/agents/assistant.md $A "$E1" "$B1" > $D/assistant-bmad.md
gen assistant crew/agents/assistant.md $A "${E1},${E2}:codex_local,${E3}:opencode_local" "$B1" "$R1" > $D/assistant-runtimes.md
for r in executor reviewer integrator bmad; do gen $r crew/agents/$r.md $A > $D/$r.md; done
```
