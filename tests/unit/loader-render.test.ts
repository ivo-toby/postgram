import { describe, expect, it } from 'vitest';

import { renderLoaderResult } from '../../src/services/loaders/render.js';
import type { Block, LoaderResult } from '../../src/types/loader.js';

function render(blocks: Block[]): string {
  const result: LoaderResult = { documentType: 'doc', blocks };
  return renderLoaderResult(result);
}

describe('renderLoaderResult', () => {
  it('renders a single text block as is', () => {
    expect(render([{ kind: 'text', text: 'hello world' }])).toBe('hello world');
  });

  it('returns an empty string when nothing renders', () => {
    expect(render([])).toBe('');
    expect(
      render([
        { kind: 'text', text: '   ' },
        { kind: 'audio', attachmentRef: 'a', durationSeconds: 3 }
      ])
    ).toBe('');
  });

  it('joins blocks with blank lines', () => {
    expect(
      render([
        { kind: 'heading', level: 2, text: 'Title' },
        { kind: 'text', text: 'Paragraph one.' },
        { kind: 'text', text: 'Paragraph two.' }
      ])
    ).toBe('## Title\n\nParagraph one.\n\nParagraph two.');
  });

  it('renders headings with the correct level', () => {
    expect(render([{ kind: 'heading', level: 3, text: 'Section' }])).toBe(
      '### Section'
    );
  });

  it('renders code blocks as fenced Markdown with the language', () => {
    expect(
      render([{ kind: 'code', text: 'const a = 1;', language: 'ts' }])
    ).toBe('```ts\nconst a = 1;\n```');
    expect(render([{ kind: 'code', text: 'x' }])).toBe('```\nx\n```');
  });

  it('renders tables as Markdown', () => {
    const out = render([
      {
        kind: 'table',
        rows: [
          ['col1', 'col2'],
          ['a', 'b']
        ],
        caption: 'sample'
      }
    ]);
    expect(out).toBe(
      ['**sample**', '| col1 | col2 |', '| --- | --- |', '| a | b |'].join('\n')
    );
  });

  describe('page markers', () => {
    it('writes [page N] on its own line before the first block with a page', () => {
      const out = render([
        { kind: 'text', text: 'one', metadata: { page: 1 } },
        { kind: 'text', text: 'two', metadata: { page: 1 } }
      ]);
      expect(out).toBe('[page 1]\none\n\ntwo');
    });

    it('writes a new marker only when the page changes', () => {
      const out = render([
        { kind: 'text', text: 'a', metadata: { page: 1 } },
        { kind: 'text', text: 'b', metadata: { page: 2 } },
        { kind: 'text', text: 'c', metadata: { page: 2 } },
        { kind: 'text', text: 'd', metadata: { page: 3 } }
      ]);
      expect(out.split('\n').filter((l) => l.startsWith('[page'))).toEqual([
        '[page 1]',
        '[page 2]',
        '[page 3]'
      ]);
      expect(out).toBe('[page 1]\na\n\n[page 2]\nb\n\nc\n\n[page 3]\nd');
    });

    it('writes no marker for blocks without a page', () => {
      expect(
        render([
          { kind: 'text', text: 'a' },
          { kind: 'text', text: 'b' }
        ])
      ).toBe('a\n\nb');
    });

    it('does not repeat a marker after an unpaged block in the same page', () => {
      const out = render([
        { kind: 'text', text: 'a', metadata: { page: 4 } },
        { kind: 'text', text: 'b' },
        { kind: 'text', text: 'c', metadata: { page: 4 } }
      ]);
      expect(out).toBe('[page 4]\na\n\nb\n\nc');
    });

    it('does not emit a marker for a block that renders to nothing', () => {
      const out = render([
        { kind: 'text', text: '  ', metadata: { page: 1 } },
        { kind: 'text', text: 'x', metadata: { page: 2 } }
      ]);
      expect(out).toBe('[page 2]\nx');
    });

    it('ignores a non-numeric page', () => {
      const out = render([
        {
          kind: 'text',
          text: 'a',
          metadata: { page: 'iv' as unknown as number }
        }
      ]);
      expect(out).toBe('a');
    });
  });

  describe('transcript blocks', () => {
    const t = (
      startSeconds: number,
      text: string,
      speaker?: string
    ): Block => ({
      kind: 'transcript',
      text,
      startSeconds,
      endSeconds: startSeconds + 1,
      ...(speaker !== undefined ? { speaker } : {})
    });

    it('renders [mm:ss] speaker: text', () => {
      expect(render([t(124.2, 'we discussed it', 'alice')])).toBe(
        '[02:04] alice: we discussed it'
      );
    });

    it('omits the speaker when absent', () => {
      expect(render([t(5, 'hello')])).toBe('[00:05] hello');
    });

    it('uses [h:mm:ss] from one hour on', () => {
      expect(render([t(3599, 'a')])).toBe('[59:59] a');
      expect(render([t(3600, 'b')])).toBe('[1:00:00] b');
      expect(render([t(3723, 'c', 'bob')])).toBe('[1:02:03] bob: c');
      expect(render([t(36000 + 61, 'd')])).toBe('[10:01:01] d');
    });

    it('clamps negative and non-finite start times to zero', () => {
      expect(render([t(-4, 'a')])).toBe('[00:00] a');
      expect(render([t(Number.NaN, 'b')])).toBe('[00:00] b');
    });

    it('combines with page markers', () => {
      expect(
        render([
          {
            kind: 'transcript',
            text: 'x',
            startSeconds: 1,
            endSeconds: 2,
            metadata: { page: 1 }
          }
        ])
      ).toBe('[page 1]\n[00:01] x');
    });
  });

  describe('image blocks', () => {
    it('prefers OCR text over caption and alt', () => {
      expect(
        render([
          {
            kind: 'image',
            attachmentRef: 'r',
            ocrText: 'Figure 1',
            caption: 'a diagram',
            alt: 'logo'
          }
        ])
      ).toBe('Figure 1');
    });

    it('falls back to caption, then alt', () => {
      expect(
        render([
          {
            kind: 'image',
            attachmentRef: 'r',
            ocrText: '  ',
            caption: 'a diagram',
            alt: 'logo'
          }
        ])
      ).toBe('a diagram');
      expect(
        render([{ kind: 'image', attachmentRef: 'r', alt: 'company logo' }])
      ).toBe('company logo');
    });

    it('renders nothing for an image without text', () => {
      expect(render([{ kind: 'image', attachmentRef: 'r' }])).toBe('');
    });
  });

  it('renders nothing for bare audio and video blocks', () => {
    expect(
      render([
        { kind: 'audio', attachmentRef: 'a', durationSeconds: 30 },
        { kind: 'video', attachmentRef: 'v', durationSeconds: 90 }
      ])
    ).toBe('');
  });

  describe('tables', () => {
    it('escapes pipes in cells', () => {
      expect(
        render([
          {
            kind: 'table',
            rows: [
              ['a|b', 'c'],
              ['x|y', 'z']
            ]
          }
        ])
      ).toBe('| a\\|b | c |\n| --- | --- |\n| x\\|y | z |');
    });

    it('replaces newlines in cells with a space', () => {
      const out = render([
        {
          kind: 'table',
          rows: [
            ['h1', 'h2'],
            ['line1\nline2', 'a\r\nb']
          ]
        }
      ]);
      expect(out).toBe('| h1 | h2 |\n| --- | --- |\n| line1 line2 | a b |');
    });

    it('pads short rows and truncates long rows to the header width', () => {
      const out = render([
        {
          kind: 'table',
          rows: [['h1', 'h2'], ['only'], ['a', 'b', 'extra', 'more']]
        }
      ]);
      expect(out).toBe('| h1 | h2 |\n| --- | --- |\n| only |  |\n| a | b |');
    });

    it('renders nothing for an empty header row or no rows', () => {
      expect(render([{ kind: 'table', rows: [[]] }])).toBe('');
      expect(render([{ kind: 'table', rows: [], caption: 'c' }])).toBe('');
      expect(
        render([
          { kind: 'table', rows: [[]], caption: 'c', metadata: { page: 3 } },
          { kind: 'text', text: 'x' }
        ])
      ).toBe('x');
    });
  });

  describe('blank blocks', () => {
    it('render nothing and trigger no page marker', () => {
      expect(
        render([
          { kind: 'heading', level: 1, text: '  ', metadata: { page: 1 } },
          { kind: 'code', text: '\n ', metadata: { page: 2 } },
          {
            kind: 'transcript',
            text: ' ',
            startSeconds: 1,
            endSeconds: 2,
            metadata: { page: 3 }
          }
        ])
      ).toBe('');
    });

    it('keeps a heading on one line', () => {
      expect(render([{ kind: 'heading', level: 2, text: 'a\nb' }])).toBe(
        '## a b'
      );
    });
  });

  describe('code fences', () => {
    it('uses three backticks when the body has none', () => {
      expect(render([{ kind: 'code', text: 'x' }])).toBe('```\nx\n```');
    });

    it('uses a fence one longer than the longest backtick run', () => {
      expect(render([{ kind: 'code', text: 'a ``` b' }])).toBe(
        '````\na ``` b\n````'
      );
      expect(
        render([{ kind: 'code', text: '`` and ````` and `', language: 'md' }])
      ).toBe('``````md\n`` and ````` and `\n``````');
    });

    it('keeps the minimum of three for short runs', () => {
      expect(render([{ kind: 'code', text: '`x`' }])).toBe('```\n`x`\n```');
    });

    it('drops characters from the language that would break the fence line', () => {
      expect(
        render([{ kind: 'code', text: 'x', language: 'ts`\nfoo bar' }])
      ).toBe('```tsfoobar\nx\n```');
    });
  });

  it('strips NUL characters from the output', () => {
    expect(
      render([
        { kind: 'heading', level: 1, text: 'T\u0000itle' },
        { kind: 'text', text: 'a\u0000b' }
      ])
    ).toBe('# Title\n\nab');
  });
});
