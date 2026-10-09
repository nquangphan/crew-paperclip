// Fixture cố ý vi phạm luật design system; chỉ test/guards dùng, không đưa vào src.
import { Trash } from 'lucide-react';

export function BadScreen() {
  return (
    <div style={{ color: 'red' }} className="text-red-500 flex">
      <Trash />
    </div>
  );
}
