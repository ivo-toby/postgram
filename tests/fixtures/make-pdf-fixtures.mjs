// Regenerates the PDF fixtures in this directory. No dependencies:
//   node tests/fixtures/make-pdf-fixtures.mjs
// The files are minimal hand-written PDF 1.4 documents with neutral text.
//
// encrypted-user-password.pdf is not written by this script. It was made once
// from three-pages.pdf with pypdf 7.0.1 (user password "secret"):
//   uvx --with cryptography --from pypdf python3 -c "
//   from pypdf import PdfWriter
//   w = PdfWriter(clone_from='tests/fixtures/three-pages.pdf')
//   w.encrypt(user_password='secret', owner_password='owner', algorithm='AES-256')
//   w.write('tests/fixtures/encrypted-user-password.pdf')"
// Nothing from pypdf is a repository dependency.
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Build a PDF from page content streams; `info` is an optional Info dict body. */
function buildPdf(contents, info) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (const stream of contents) {
    const contentId = add(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    );
  }
  const infoId = info ? add(`<< ${info} >>`) : undefined;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets)
    out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R` +
    `${infoId ? ` /Info ${infoId} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const line = (y, text) => `BT /F1 12 Tf 72 ${y} Td (${text}) Tj ET`;

const threePages = buildPdf(
  [
    [
      line(700, 'Postgram fixture page one: the quick brown fox'),
      line(640, 'Second paragraph on page one.')
    ].join('\n'),
    line(700, 'Postgram fixture page two: jumps over the lazy dog'),
    line(700, 'Postgram fixture page three: zebra quartz vexing')
  ],
  '/Title (Postgram fixture document) /Producer (postgram fixture script)'
);
writeFileSync(path.join(here, 'three-pages.pdf'), threePages);

// A page with a drawn rectangle and no text operators.
writeFileSync(
  path.join(here, 'no-text.pdf'),
  buildPdf(['0.8 0.8 0.8 rg 72 600 200 100 re f'])
);

// Looks like a PDF at the start, but the body is cut off.
writeFileSync(
  path.join(here, 'corrupt.pdf'),
  Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R\n', 'latin1')
);
