import { zipSync, strToU8 } from 'fflate';
import { toDayNumber } from '../dates';
import { Cell, CellFormat, Sheet, Workbook, colLetter, safeSheetName } from './workbook';
import { aboutSheet } from './sheets';

/**
 * Minimal, dependency-light XLSX (Office Open XML) writer. Produces workbooks that open in
 * Excel, LibreOffice, Numbers and Google Sheets without Microsoft software. Formulas are
 * written without cached values and the workbook asks to be recalculated when opened.
 */

const STYLE: Record<CellFormat | 'header' | 'title', number> = {
  text: 0, header: 1, currency: 2, date: 3, percent: 4, number: 5, integer: 6, title: 7,
};

const EXCEL_EPOCH = toDayNumber('1899-12-30');

function esc(s: string): string {
  return s
    // Remove characters XML 1.0 cannot contain.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cellXml(c: Cell, r: string, colFormat?: CellFormat, bold = false): string {
  if (c === null || c === undefined || c === '') return '';
  if (typeof c === 'string') return `<c r="${r}" t="inlineStr"${bold ? ` s="${STYLE.title}"` : ''}><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
  if (typeof c === 'boolean') return `<c r="${r}" t="b"><v>${c ? 1 : 0}</v></c>`;
  if (typeof c === 'number') {
    const s = colFormat && colFormat !== 'text' ? STYLE[colFormat] : 0;
    return `<c r="${r}"${s ? ` s="${s}"` : ''}><v>${Number.isFinite(c) ? c : 0}</v></c>`;
  }
  if ('formula' in c) {
    const s = STYLE[c.format ?? colFormat ?? 'text'];
    return `<c r="${r}"${s ? ` s="${s}"` : ''}><f>${esc(c.formula)}</f></c>`;
  }
  if ('date' in c) return `<c r="${r}" s="${STYLE.date}"><v>${toDayNumber(c.date) - EXCEL_EPOCH}</v></c>`;
  return `<c r="${r}" s="${STYLE[c.format]}"><v>${Number.isFinite(c.value) ? Math.round(c.value * 1e6) / 1e6 : 0}</v></c>`;
}

function sheetXml(sheet: Sheet, isAbout: boolean): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.max(10, Math.min(50, c.header.length + 4))}" customWidth="1"/>`)
    .join('');
  const header = `<row r="1">${sheet.columns.map((c, i) => (c.header ? `<c r="${colLetter(i)}1" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${esc(c.header)}</t></is></c>` : '')).join('')}</row>`;
  const body = sheet.rows
    .map((row, ri) => {
      const r = ri + 2;
      const bold = isAbout && (ri === 0 || (typeof row[0] === 'string' && !row[0].startsWith('   ') && ri > 4));
      return `<row r="${r}">${row.map((c, ci) => cellXml(c, `${colLetter(ci)}${r}`, sheet.columns[ci]?.format, bold)).join('')}</row>`;
    })
    .join('');
  const views = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${views}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEDE6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9A968B"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function workbookToXlsx(wb: Workbook, opts: { includeAbout?: boolean } = {}): Uint8Array {
  const sheets = opts.includeAbout === false ? wb.sheets : [aboutSheet(wb), ...wb.sheets];
  const used = new Set<string>();
  const names = sheets.map((s) => {
    let n = safeSheetName(s.name);
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${safeSheetName(s.name).slice(0, 28)} ${k++}`;
    used.add(n.toLowerCase());
    return n;
  });
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(wb.title)}</dc:title><dc:creator>Geranium</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${wb.createdAt}T00:00:00Z</dcterms:created></cp:coreProperties>`);
  files['docProps/app.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Geranium</Application></Properties>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8(STYLES_XML);
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml({ ...s, name: names[i] }, i === 0 && opts.includeAbout !== false));
  });
  return zipSync(files, { level: 6 });
}
