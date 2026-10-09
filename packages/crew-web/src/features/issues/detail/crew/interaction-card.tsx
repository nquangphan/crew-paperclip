// crew: tự dựng
import type {
  AskUserQuestionsAnswer,
  AskUserQuestionsInteraction,
  Issue,
  RequestCheckboxConfirmationInteraction,
  RequestConfirmationInteraction,
} from '@paperclipai/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '@/api';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ErrorState,
  Label,
  MarkdownView,
  MutedText,
  Textarea,
} from '@/ds';
import { useT } from '@/i18n';
import { useRefreshAfterGate } from './actions-slot';

export type CardInteraction =
  | AskUserQuestionsInteraction
  | RequestConfirmationInteraction
  | RequestCheckboxConfirmationInteraction;

export const CARD_KINDS = new Set(['ask_user_questions', 'request_confirmation', 'request_checkbox_confirmation']);

type Question = AskUserQuestionsInteraction['payload']['questions'][number];

interface Choice {
  optionIds: string[];
  /** Đang chọn "Khác" (phương án freeText của câu hỏi, hoặc ô Khác khi `allowOther`). */
  other: boolean;
  text: string;
}

const EMPTY: Choice = { optionIds: [], other: false, text: '' };

/** Phương án tự ghi của câu hỏi; câu hỏi chỉ có phương án này là câu hỏi nhập chữ. */
const freeTextOption = (q: Question) => q.options.find((o) => o.freeText);
const textOnly = (q: Question) => q.options.length > 0 && q.options.every((o) => o.freeText);

function hasAnswer(q: Question, c: Choice): boolean {
  if (c.other || textOnly(q)) return c.text.trim() !== '' || c.optionIds.some((id) => id !== freeTextOption(q)?.id);
  return c.optionIds.length > 0;
}

/** Answer gửi POST …/respond (respondIssueThreadInteractionSchema): optionIds kèm otherText khi chọn "Khác". */
export function toAnswer(q: Question, c: Choice): AskUserQuestionsAnswer {
  const free = freeTextOption(q);
  const typing = c.other || textOnly(q);
  const optionIds = typing && free && !c.optionIds.includes(free.id) ? [...c.optionIds, free.id] : c.optionIds;
  const otherText = typing ? c.text.trim() : '';
  return { questionId: q.id, optionIds, ...(otherText ? { otherText } : {}) };
}

function QuestionBlock({
  question,
  choice,
  onChange,
}: {
  question: Question;
  choice: Choice;
  onChange: (next: Choice) => void;
}) {
  const { t } = useT('issues');
  const free = freeTextOption(question);
  const single = question.selectionMode === 'single';
  const typing = choice.other || textOnly(question);
  const pick = (id: string) => {
    if (free && id === free.id) {
      const on = !choice.other;
      onChange({ ...choice, other: on, optionIds: single ? (on ? [id] : []) : toggle(choice.optionIds, id) });
      return;
    }
    if (single) onChange({ ...choice, other: false, optionIds: choice.optionIds[0] === id ? [] : [id] });
    else onChange({ ...choice, optionIds: toggle(choice.optionIds, id) });
  };
  const pickOther = () => {
    const on = !choice.other;
    onChange({ ...choice, other: on, optionIds: single && on ? [] : choice.optionIds });
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend>{question.prompt}</legend>
      {question.helpText ? <MutedText>{question.helpText}</MutedText> : null}
      {textOnly(question) ? null : (
        <div className="flex flex-wrap gap-2">
          {question.options.map((o) => {
            const on = o.freeText ? choice.other : choice.optionIds.includes(o.id);
            return (
              <Button
                key={o.id}
                type="button"
                size="sm"
                variant={on ? 'default' : 'outline'}
                aria-pressed={on}
                title={o.description ?? undefined}
                onClick={() => pick(o.id)}
              >
                {o.label}
              </Button>
            );
          })}
          {question.allowOther && !free ? (
            <Button
              type="button"
              size="sm"
              variant={choice.other ? 'default' : 'outline'}
              aria-pressed={choice.other}
              onClick={pickOther}
            >
              {t('interactions.other')}
            </Button>
          ) : null}
        </div>
      )}
      {typing ? (
        <Textarea
          aria-label={t('interactions.otherLabel', { question: question.prompt })}
          value={choice.text}
          onChange={(e) => onChange({ ...choice, text: e.target.value })}
        />
      ) : null}
    </fieldset>
  );
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

function QuestionsBody({
  interaction,
  pending,
  onSubmit,
}: {
  interaction: AskUserQuestionsInteraction;
  pending: boolean;
  onSubmit: (answers: AskUserQuestionsAnswer[]) => void;
}) {
  const { t } = useT('issues');
  const questions = interaction.payload.questions;
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const choiceOf = (q: Question) => choices[q.id] ?? EMPTY;
  const answered = questions.filter((q) => hasAnswer(q, choiceOf(q)));
  const ready = answered.length > 0 && questions.every((q) => !q.required || hasAnswer(q, choiceOf(q)));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !pending) onSubmit(answered.map((q) => toAnswer(q, choiceOf(q))));
      }}
    >
      {questions.map((q) => (
        <QuestionBlock
          key={q.id}
          question={q}
          choice={choiceOf(q)}
          onChange={(next) => setChoices((all) => ({ ...all, [q.id]: next }))}
        />
      ))}
      <div className="flex">
        <Button type="submit" size="sm" disabled={!ready || pending}>
          {interaction.payload.submitLabel ?? t('interactions.send')}
        </Button>
      </div>
    </form>
  );
}

function ConfirmBody({
  interaction,
  pending,
  onAccept,
  onReject,
}: {
  interaction: RequestConfirmationInteraction | RequestCheckboxConfirmationInteraction;
  pending: boolean;
  onAccept: (selectedOptionIds?: string[]) => void;
  onReject: (reason: string) => void;
}) {
  const { t } = useT('issues');
  const id = useId();
  const p = interaction.payload;
  const checkbox = interaction.kind === 'request_checkbox_confirmation' ? interaction.payload : null;
  const [selected, setSelected] = useState<string[]>(checkbox?.defaultSelectedOptionIds ?? []);
  const [reason, setReason] = useState('');
  const askReason = p.allowDeclineReason !== false || p.rejectRequiresReason === true;
  const rejectBlocked = p.rejectRequiresReason === true && reason.trim() === '';
  return (
    <div className="flex flex-col gap-3">
      <p>{p.prompt}</p>
      {p.detailsMarkdown ? <MarkdownView markdown={p.detailsMarkdown} /> : null}
      {checkbox ? (
        <div className="flex flex-col gap-2">
          {checkbox.options.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${o.id}`}
                checked={selected.includes(o.id)}
                onCheckedChange={() => setSelected((s) => toggle(s, o.id))}
              />
              <Label htmlFor={`${id}-${o.id}`}>{o.label}</Label>
            </div>
          ))}
        </div>
      ) : null}
      {askReason ? (
        <Textarea
          aria-label={p.rejectReasonLabel ?? t('interactions.rejectReason')}
          placeholder={p.declineReasonPlaceholder ?? undefined}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            onAccept(checkbox ? checkbox.options.map((o) => o.id).filter((x) => selected.includes(x)) : undefined)
          }
        >
          {p.acceptLabel ?? t('interactions.accept')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || rejectBlocked}
          onClick={() => onReject(reason.trim())}
        >
          {p.rejectLabel ?? t('interactions.reject')}
        </Button>
      </div>
    </div>
  );
}

/** Thẻ câu hỏi / xác nhận của Trợ Lý (S6.9). Trả lời xong thì Trợ Lý chạy tiếp (server đánh thức). */
export function InteractionCard({ issue, interaction }: { issue: Issue; interaction: CardInteraction }) {
  const { t } = useT('issues');
  const refresh = useRefreshAfterGate(issue);
  const resolve = useMutation({
    mutationFn: (call: () => Promise<unknown>) => call(),
    onSuccess: refresh,
  });
  const title =
    interaction.title ??
    (interaction.kind === 'ask_user_questions'
      ? (interaction.payload.title ?? t('interactions.questionTitle'))
      : t('interactions.confirmTitle'));
  return (
    <Card data-testid="interaction-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {interaction.summary ? <MutedText>{interaction.summary}</MutedText> : null}
        {interaction.kind === 'ask_user_questions' ? (
          <QuestionsBody
            interaction={interaction}
            pending={resolve.isPending}
            onSubmit={(answers) =>
              resolve.mutate(() => api.interactions.respond(issue.id, interaction.id, { answers }))
            }
          />
        ) : (
          <ConfirmBody
            interaction={interaction}
            pending={resolve.isPending}
            onAccept={(selectedOptionIds) =>
              resolve.mutate(() =>
                api.interactions.accept(issue.id, interaction.id, selectedOptionIds ? { selectedOptionIds } : {}),
              )
            }
            onReject={(reason) =>
              resolve.mutate(() => api.interactions.reject(issue.id, interaction.id, reason || undefined))
            }
          />
        )}
        {resolve.error ? <ErrorState title={t('interactions.failed')} message={resolve.error.message} /> : null}
      </CardContent>
    </Card>
  );
}
