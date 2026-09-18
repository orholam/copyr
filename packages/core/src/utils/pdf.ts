/**
 * Minimal dependency-free PDF writer producing single-font, multi-page,
 * text-only but fully spec-valid PDFs. Used by the mock link converter and
 * tests; real conversions slot in behind the same interface later.
 */

interface PageSpec {
  title?: string;
  lines: string[];
}

function escapePdfText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Wrap plain text into lines of ~90 chars so nothing overflows the page. */
export function wrapText(text: string, width = 92): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      out.push("");
      continue;
    }
    let current = "";
    for (const word of rawLine.split(/\s+/)) {
      if ((current + " " + word).trim().length > width) {
        out.push(current.trim());
        current = word;
      } else {
        current += ` ${word}`;
      }
    }
    if (current.trim()) out.push(current.trim());
  }
  return out;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 56;
const TOP_Y = PAGE_H - 64;
const LINE_H = 16;
const LINES_PER_PAGE = Math.floor((PAGE_H - 128) / LINE_H);

export function makePdf(title: string, bodyText: string): Buffer {
  // paginate
  const allLines = wrapText(bodyText);
  const pages: PageSpec[] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(allLines.length / LINES_PER_PAGE)); i++) {
    pages.push({ title, lines: allLines.slice(i * LINES_PER_PAGE, (i + 1) * LINES_PER_PAGE) });
  }

  const objects: string[] = []; // 1-indexed object bodies without "N 0 obj"
  const nPages = pages.length;
  // object layout: 1 catalog, 2 pages, then per page: content obj + page obj, last font obj
  const firstPageObjNum = 3;
  const kids = Array.from({ length: nPages }, (_, i) => `${firstPageObjNum + i * 2} 0 R`).join(" ");
  const fontObjNum = firstPageObjNum + nPages * 2;

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Version /1.4 /Kids [${kids}] /Count ${nPages} >>`,
  );
  for (let i = 0; i < nPages; i++) {
    const pageNumObj = firstPageObjNum + i * 2;
    const contentNum = pageNumObj + 1;
    const p = pages[i]!;
    let stream = "BT\n";
    let y = TOP_Y;
    if (i === 0 || p.title) {
      stream += `/F1 16 Tf 1 0 0 1 ${MARGIN_X} ${y} Tm (${escapePdfText(p.title ?? title)}) Tj\n`;
      y -= 28;
    }
    stream += `/F1 10 Tf 1 0 0 1 ${MARGIN_X} ${y} Tm\n`;
    for (const line of p.lines) {
      stream += `(${escapePdfText(line)}) Tj 0 -${LINE_H} Td\n`;
    }
    stream += "ET";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentNum} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);

  // serialize with xref offsets
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}
