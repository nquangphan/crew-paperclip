// crew: tự dựng
import { useT } from '@/i18n';
import { Button } from '../components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible';

interface TranscriptEntry {
  id: string;
  role: 'assistant' | 'user' | 'tool' | 'system';
  text: string;
}

interface TranscriptProps {
  entries: TranscriptEntry[];
  defaultOpen?: boolean;
}

/** Nội dung run, mặc định thu gọn. */
function Transcript({ entries, defaultOpen = false }: TranscriptProps) {
  const { t } = useT();
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{t('transcript.empty')}</p>;
  return (
    <Collapsible defaultOpen={defaultOpen} data-slot="transcript">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm">
          {defaultOpen ? t('transcript.hide') : t('transcript.show')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.id} data-role={e.role} className="rounded-md border p-2 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">{t(`transcript.role.${e.role}`)}</div>
              <pre className="font-mono text-xs break-words whitespace-pre-wrap">{e.text}</pre>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

export type { TranscriptEntry, TranscriptProps };
export { Transcript };
