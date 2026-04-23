import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
};

export default function MarkdownEditor({ value, onChange, placeholder, minHeight = 320, autoFocus }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  // Guard against re-emitting the value we just applied from props.
  const skipNextEmit = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Start writing…' }),
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: false,
        tightLists: true,
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value || '',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'tiptap-content',
      },
    },
    onUpdate: ({ editor }) => {
      if (skipNextEmit.current) {
        skipNextEmit.current = false;
        return;
      }
      const md = getMarkdown(editor);
      onChange(md);
    },
  });

  // Sync external value changes into the editor (e.g. when entity.id changes).
  useEffect(() => {
    if (!editor) return;
    const current = getMarkdown(editor);
    if (current === value) return;
    skipNextEmit.current = true;
    editor.commands.setContent(value || '', { emitUpdate: false });
  }, [editor, value]);

  // Esc closes fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // When entering fullscreen, lock the body scroll.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  const editorBox = (
    <div className={`pgm-tiptap flex flex-col ${fullscreen ? 'flex-1 min-h-0' : ''}`}>
      <Toolbar editor={editor} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen(v => !v)} />
      <div
        className={`tiptap-scroll flex-1 overflow-y-auto bg-gray-800 border border-gray-700 border-t-0 rounded-b-lg ${fullscreen ? 'min-h-0' : ''}`}
        style={fullscreen ? undefined : { minHeight }}
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent editor={editor} className="tiptap-editor" />
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
        <div className="mx-auto w-full max-w-4xl flex-1 min-h-0 flex flex-col p-4 sm:p-6">
          {editorBox}
        </div>
      </div>
    );
  }

  return editorBox;
}

type ToolbarProps = {
  editor: Editor | null;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
};

function Toolbar({ editor, fullscreen, onToggleFullscreen }: ToolbarProps) {
  // Subscribe to editor transactions so active-state classes re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => setTick(t => t + 1);
    editor.on('transaction', handler);
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('transaction', handler);
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  const isActive = useCallback((name: string, attrs?: Record<string, unknown>) => {
    if (!editor) return false;
    return attrs ? editor.isActive(name, attrs) : editor.isActive(name);
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-t-lg px-1.5 py-1 text-gray-300">
      <Btn label="B" title="Bold (⌘B)" active={isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} bold />
      <Btn label="I" title="Italic (⌘I)" active={isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} italic />
      <Btn label="S" title="Strikethrough" active={isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()} strike />
      <Btn label="Code" title="Inline code" active={isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()} />
      <Sep />
      <Btn label="H1" title="Heading 1" active={isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
      <Btn label="H2" title="Heading 2" active={isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Btn label="H3" title="Heading 3" active={isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
      <Sep />
      <Btn label="•" title="Bullet list" active={isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
      <Btn label="1." title="Numbered list" active={isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
      <Btn label="☐" title="Task list" active={isActive('taskList')} onClick={() => editor?.chain().focus().toggleTaskList().run()} />
      <Btn label="❝" title="Quote" active={isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
      <Btn label="{ }" title="Code block" active={isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
      <Btn label="—" title="Horizontal rule" onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
      <Sep />
      <Btn
        label="🔗"
        title="Toggle link"
        active={isActive('link')}
        onClick={() => {
          if (!editor) return;
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const prev = (editor.getAttributes('link') as { href?: string }).href ?? '';
          const url = window.prompt('URL', prev);
          if (url === null) return;
          if (url.trim() === '') { editor.chain().focus().unsetLink().run(); return; }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
        }}
      />
      <Sep />
      <Btn label="↶" title="Undo" onClick={() => editor?.chain().focus().undo().run()} />
      <Btn label="↷" title="Redo" onClick={() => editor?.chain().focus().redo().run()} />

      <div className="ml-auto flex items-center">
        <Btn
          label={fullscreen ? '⤢' : '⛶'}
          title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          onClick={onToggleFullscreen}
        />
      </div>
    </div>
  );
}

function getMarkdown(editor: Editor): string {
  // tiptap-markdown augments editor.storage at runtime; the exported type
  // doesn't reflect that, so we reach for it via an explicit cast.
  const storage = (editor.storage as unknown as Record<string, unknown>)['markdown'] as
    | { getMarkdown?: () => string }
    | undefined;
  return storage?.getMarkdown?.() ?? '';
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-gray-700" aria-hidden />;
}

type BtnProps = {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
};

function Btn({ label, title, active, onClick, bold, italic, strike }: BtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
      onClick={onClick}
      className={`min-w-[28px] px-1.5 h-7 rounded text-xs leading-none transition-colors ${
        active ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-300'
      } ${bold ? 'font-bold' : ''} ${italic ? 'italic' : ''} ${strike ? 'line-through' : ''}`}
    >
      {label}
    </button>
  );
}
