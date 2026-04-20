# Markdown Editor Upgrade

**Goal:** Replace the bare textarea in EntityDetail with a split-pane editor: formatting toolbar on top, textarea left, live preview right, togglable to full-screen preview.

**Architecture:** Self-contained `MarkdownEditor` component that receives `value` + `onChange`. EntityDetail swaps its current textarea for this component. No new library — plain textarea + ReactMarkdown (already installed) + `@tailwindcss/typography` (already installed).

**Tech Stack:** React 19, ReactMarkdown, @tailwindcss/typography, existing Tailwind dark theme.

---

## Component: `ui/src/components/MarkdownEditor.tsx`

```tsx
type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};
```

### Layout

```
┌─────────────────────────────────────┐
│ [B] [I] [H] [``] [link] [☑] [👁 Preview] │  ← toolbar
├──────────────────┬──────────────────┤
│                  │                  │
│   textarea       │  ReactMarkdown   │
│                  │  preview         │
│                  │                  │
└──────────────────┴──────────────────┘
```

Toggle button switches between split view and preview-only (textarea hidden). Default: split view.

### Toolbar buttons

| Button | Markdown inserted | Cursor behaviour |
|---|---|---|
| **B** | `**selection**` | wrap selection or insert `**bold**` |
| *I* | `*selection*` | wrap selection or insert `*italic*` |
| H | `## ` | prepend to current line |
| `` ` `` | `` `selection` `` | wrap selection or insert `` `code` `` |
| Link | `[selection](url)` | wrap selection, place cursor on `url` |
| ☑ | `- [ ] ` | prepend to current line |
| 👁 | — | toggle preview-only mode |

Toolbar uses `textareaRef` to read/write selection via `selectionStart`/`selectionEnd` and calls `onChange` after each insertion. Cursor is restored after insertion using `setSelectionRange`.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Cmd/Ctrl + B | Bold |
| Cmd/Ctrl + I | Italic |
| Cmd/Ctrl + P | Toggle preview |

Attached via `onKeyDown` on the textarea.

---

## EntityDetail change

Replace the `<textarea>` in editing mode with `<MarkdownEditor value={draft} onChange={setDraft} />`. Remove the inline textarea styles — MarkdownEditor owns its own layout.

---

## Out of Scope

- Auto-save (Postgram saves on explicit "Save" click)
- Image upload
- Table insertion
- Full-screen mode
- CodeMirror / Monaco (overkill for this use case)
