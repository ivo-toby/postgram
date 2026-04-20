import { useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

type ToolbarAction = {
  label: string;
  title: string;
  action: (textarea: HTMLTextAreaElement, value: string, onChange: (v: string) => void) => void;
};

function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  before: string,
  after: string,
  placeholder: string
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end) || placeholder;
  const newValue = value.slice(0, start) + before + selected + after + value.slice(end);
  onChange(newValue);
  // Restore cursor after state update
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
  });
}

function prependLine(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  prefix: string
) {
  const start = textarea.selectionStart;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + prefix.length, start + prefix.length);
  });
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    label: 'B',
    title: 'Bold (Cmd+B)',
    action: (ta, val, onChange) => wrapSelection(ta, val, onChange, '**', '**', 'bold'),
  },
  {
    label: 'I',
    title: 'Italic (Cmd+I)',
    action: (ta, val, onChange) => wrapSelection(ta, val, onChange, '*', '*', 'italic'),
  },
  {
    label: 'H',
    title: 'Heading',
    action: (ta, val, onChange) => prependLine(ta, val, onChange, '## '),
  },
  {
    label: '`',
    title: 'Inline code',
    action: (ta, val, onChange) => wrapSelection(ta, val, onChange, '`', '`', 'code'),
  },
  {
    label: '[]',
    title: 'Task item',
    action: (ta, val, onChange) => prependLine(ta, val, onChange, '- [ ] '),
  },
  {
    label: '🔗',
    title: 'Link',
    action: (ta, val, onChange) => wrapSelection(ta, val, onChange, '[', '](url)', 'link text'),
  },
];

export default function MarkdownEditor({ value, onChange, disabled = false }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewOnly, setPreviewOnly] = useState(false);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const meta = e.metaKey || e.ctrlKey;
    const ta = textareaRef.current;
    if (!ta) return;
    if (meta && e.key === 'b') {
      e.preventDefault();
      wrapSelection(ta, value, onChange, '**', '**', 'bold');
    } else if (meta && e.key === 'i') {
      e.preventDefault();
      wrapSelection(ta, value, onChange, '*', '*', 'italic');
    } else if (meta && e.key === 'p') {
      e.preventDefault();
      setPreviewOnly(p => !p);
    }
  }, [value, onChange]);

  return (
    <div className="flex flex-col gap-0 border border-gray-700 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-gray-800 border-b border-gray-700">
        {TOOLBAR_ACTIONS.map(action => (
          <button
            key={action.label}
            type="button"
            title={action.title}
            disabled={disabled}
            onMouseDown={e => {
              e.preventDefault(); // prevent textarea blur
              if (textareaRef.current) action.action(textareaRef.current, value, onChange);
            }}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors disabled:opacity-40 font-mono"
          >
            {action.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          title="Toggle preview (Cmd+P)"
          onMouseDown={e => { e.preventDefault(); setPreviewOnly(p => !p); }}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            previewOnly ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          👁
        </button>
      </div>

      {/* Editor / Preview — single column */}
      <div className="min-h-48">
        {!previewOnly ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="w-full bg-gray-900 text-sm text-white p-3 resize-none focus:outline-none min-h-48 font-mono block"
            placeholder="Write in markdown…"
          />
        ) : (
          <div className="p-3 bg-gray-900 min-h-48">
            {value ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{value}</ReactMarkdown>
              </div>
            ) : (
              <span className="text-gray-600 italic text-sm">Nothing to preview.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
