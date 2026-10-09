// Fixture cố ý vi phạm luật design system; chỉ test/guards dùng, không đưa vào src.

// @ts-expect-error gói con radix không cài trực tiếp; fixture chỉ để bộ quét import bắt.
import { Dialog } from '@radix-ui/react-dialog';
import { ReactFlow } from '@xyflow/react';
import { Command } from 'cmdk';
import { Trash } from 'lucide-react';
import { cn } from '@/ds/cn';

export function BadScreen() {
  return (
    <div style={{ color: 'red' }} className="text-red-500 flex">
      <Trash />
      <div className={cn('flex gap-2', 'text-blue-500', true && 'bg-red-50')}>
        <Dialog />
        <Command />
        <ReactFlow />
      </div>
    </div>
  );
}
