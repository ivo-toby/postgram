import { lazy, Suspense, useEffect, useState } from 'react';

const MDEditor = lazy(() => import('@uiw/react-md-editor'));

type PreviewMode = 'edit' | 'preview' | 'live';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
};

const MODES: { key: PreviewMode; label: string; hideOnMobile?: boolean }[] = [
  { key: 'edit', label: 'Write' },
  { key: 'live', label: 'Split', hideOnMobile: true },
  { key: 'preview', label: 'Preview' },
];

export default function MarkdownEditor({ value, onChange, placeholder, minHeight = 280, autoFocus }: Props) {
  const [mode, setMode] = useState<PreviewMode>('edit');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (e.matches && mode === 'live') setMode('edit');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const availableModes = MODES.filter(m => !(m.hideOnMobile && isMobile));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-[11px]">
        <div className="inline-flex rounded-md border border-gray-700 overflow-hidden">
          {availableModes.map(m => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`px-2.5 py-1 transition-colors ${
                mode === m.key ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Suspense
        fallback={
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-vertical focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ minHeight }}
          />
        }
      >
        <div className="pgm-md-editor" data-color-mode="dark">
          <MDEditor
            value={value}
            onChange={val => onChange(val ?? '')}
            preview={mode}
            hideToolbar={false}
            visibleDragbar={false}
            enableScroll
            textareaProps={{ placeholder, autoFocus }}
            height={minHeight}
            highlightEnable={false}
          />
        </div>
      </Suspense>
    </div>
  );
}
