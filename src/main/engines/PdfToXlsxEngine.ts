import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { createPdfjsDocumentOptions } from "../services/PdfjsAssetService.js";
import { applyLocalFontMatches, warmPdfPageFonts } from "../services/LocalFontMatchService.js";
import {
  extractPdfReadingOrderFragments,
  type PdfReadingOrderLine
} from "../services/PdfReadingOrderService.js";
import { applyPdfTextColors } from "../services/PdfTextColorService.js";

type ProgressCallback = (progress: number, message: string) => void;

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

interface PositionedText extends PdfReadingOrderLine {
  right: number;
  bottom: number;
  centerY: number;
}

interface RowBucket {
  items: PositionedText[];
  y: number;
  bottom: number;
  centerY: number;
  height: number;
}

interface ColumnBucket {
  x: number;
  right: number;
  count: number;
}

interface XlsxCell {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

interface XlsxRow {
  index: number;
  height: number;
  cells: Map<number, XlsxCell>;
}

interface XlsxColumn {
  index: number;
  width: number;
}

interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
  columns: XlsxColumn[];
}

interface StyleRegistry {
  stylesXml: string;
  getStyleId(cell: XlsxCell): number;
}

const DEFAULT_FONT = "Arial";
const DEFAULT_COLOR = "000000";
const MAX_SHEET_NAME_LENGTH = 31;

export class PdfToXlsxEngine {
  async convert(inputPath: string, outputPath: string, onProgress: ProgressCallback): Promise<void> {
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await readFile(inputPath));
    const document = await pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise;
    const sheets: XlsxSheet[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(
        5 + Math.round(((pageNumber - 1) / Math.max(1, document.numPages)) * 75),
        `PDF ${pageNumber}/${document.numPages} 페이지의 표와 텍스트 위치를 분석하는 중입니다.`
      );
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const fragments = extractPdfReadingOrderFragments(pdfjs, page, textContent, 1);
      await applyPdfTextColors(pdfjs, page, textContent, fragments, { splitMixedColorText: true });
      await warmPdfPageFonts(page);
      await applyLocalFontMatches(page, fragments);

      sheets.push(this.createSheet(pageNumber, fragments));
    }

    if (sheets.every((sheet) => sheet.rows.length === 0)) {
      throw new Error(
        "PDF에서 엑셀로 재구성할 수 있는 선택형 텍스트를 찾지 못했습니다. 이미지형 PDF는 OCR 없이는 XLSX로 복원할 수 없습니다."
      );
    }

    const buffer = await this.createWorkbook(sheets);
    await writeFile(outputPath, buffer);
    onProgress(95, "PDF 표와 텍스트를 XLSX 파일로 저장했습니다.");
  }

  private createSheet(pageNumber: number, fragments: PdfReadingOrderLine[]): XlsxSheet {
    const items = fragments
      .map((item): PositionedText | undefined => {
        const text = normalizeCellText(item.text);
        if (!text) return undefined;
        const width = Math.max(1, Number(item.width) || estimateTextWidth(text, item.fontSize || 10));
        const height = Math.max(1, Number(item.height) || Number(item.fontSize) || 10);
        return {
          ...item,
          text,
          width,
          height,
          right: item.x + width,
          bottom: item.y + height,
          centerY: item.y + height / 2
        };
      })
      .filter(Boolean) as PositionedText[];

    if (items.length === 0) {
      return { name: `Page ${pageNumber}`, rows: [], columns: [] };
    }

    const rows = this.createRowBuckets(items);
    const columns = this.createColumnBuckets(items);
    const modelRows: XlsxRow[] = rows.map((row, index) => ({
      index: index + 1,
      height: clamp(row.height * 1.25, 14, 120),
      cells: new Map<number, XlsxCell>()
    }));

    rows.forEach((row, rowIndex) => {
      const modelRow = modelRows[rowIndex];
      const orderedItems = [...row.items].sort((a, b) => a.x - b.x || (a.sourceIndex || 0) - (b.sourceIndex || 0));

      for (const item of orderedItems) {
        const columnIndex = this.findColumnIndex(columns, item);
        const existing = modelRow.cells.get(columnIndex);
        const nextCell = this.createCell(item);
        if (existing) {
          existing.text = joinCellText(existing.text, nextCell.text);
          existing.fontSize = Math.max(existing.fontSize, nextCell.fontSize);
          existing.bold = existing.bold || nextCell.bold;
          existing.italic = existing.italic || nextCell.italic;
          if (existing.color === DEFAULT_COLOR) existing.color = nextCell.color;
        } else {
          modelRow.cells.set(columnIndex, nextCell);
        }
      }
    });

    const modelColumns = this.createColumns(columns, modelRows);
    return {
      name: `Page ${pageNumber}`,
      rows: modelRows.filter((row) => row.cells.size > 0),
      columns: modelColumns
    };
  }

  private createRowBuckets(items: PositionedText[]): RowBucket[] {
    const buckets: RowBucket[] = [];
    const sorted = [...items].sort((a, b) => a.centerY - b.centerY || a.x - b.x);

    for (const item of sorted) {
      const bucket = buckets.find((candidate) => {
        const tolerance = Math.max(3, Math.min(14, Math.max(candidate.height, item.height) * 0.7));
        const overlap = Math.max(0, Math.min(candidate.bottom, item.bottom) - Math.max(candidate.y, item.y));
        const overlapRatio = overlap / Math.max(1, Math.min(candidate.height, item.height));
        return Math.abs(candidate.centerY - item.centerY) <= tolerance || overlapRatio >= 0.45;
      });

      if (bucket) {
        bucket.items.push(item);
        refreshRowBucket(bucket);
      } else {
        buckets.push({
          items: [item],
          y: item.y,
          bottom: item.bottom,
          centerY: item.centerY,
          height: item.height
        });
      }
    }

    return buckets.sort((a, b) => a.centerY - b.centerY);
  }

  private createColumnBuckets(items: PositionedText[]): ColumnBucket[] {
    const buckets: ColumnBucket[] = [];
    const sorted = [...items].sort((a, b) => a.x - b.x || a.right - b.right);

    for (const item of sorted) {
      let best: ColumnBucket | undefined;
      let bestScore = Number.POSITIVE_INFINITY;
      const tolerance = Math.max(6, Math.min(20, Math.max(item.fontSize || 10, item.width * 0.18)));

      for (const bucket of buckets) {
        const score = Math.min(Math.abs(item.x - bucket.x), Math.abs(item.right - bucket.right));
        if (score <= tolerance && score < bestScore) {
          best = bucket;
          bestScore = score;
        }
      }

      if (best) {
        const nextCount = best.count + 1;
        best.x = (best.x * best.count + item.x) / nextCount;
        best.right = (best.right * best.count + item.right) / nextCount;
        best.count = nextCount;
      } else {
        buckets.push({ x: item.x, right: item.right, count: 1 });
      }
    }

    return buckets.sort((a, b) => a.x - b.x).map((bucket, index) => ({ ...bucket, count: index + 1 }));
  }

  private findColumnIndex(columns: ColumnBucket[], item: PositionedText): number {
    let bestIndex = 1;
    let bestScore = Number.POSITIVE_INFINITY;

    columns.forEach((column, index) => {
      const score = Math.min(Math.abs(item.x - column.x), Math.abs(item.right - column.right));
      if (score < bestScore) {
        bestIndex = index + 1;
        bestScore = score;
      }
    });

    return bestIndex;
  }

  private createColumns(columns: ColumnBucket[], rows: XlsxRow[]): XlsxColumn[] {
    return columns.map((column, index) => {
      const next = columns[index + 1];
      const visualWidth = next ? Math.max(20, next.x - column.x) : Math.max(40, column.right - column.x);
      const maxTextLength = rows.reduce((max, row) => {
        const text = row.cells.get(index + 1)?.text || "";
        return Math.max(max, visualTextLength(text));
      }, 0);
      return {
        index: index + 1,
        width: clamp(Math.max(visualWidth / 5.4, maxTextLength * 1.05, 8), 6, 80)
      };
    });
  }

  private createCell(item: PositionedText): XlsxCell {
    const fontName = item.fontFamily || DEFAULT_FONT;
    const sourceFontName = `${item.pdfFontName || ""} ${item.fontFamily || ""}`;
    return {
      text: item.text,
      fontFamily: fontName,
      fontSize: clamp(item.fontSize || 10, 6, 36),
      color: normalizeHexColor(item.color),
      bold: /bold|black|heavy|semibold|demibold/i.test(sourceFontName),
      italic: /italic|oblique/i.test(sourceFontName)
    };
  }

  private async createWorkbook(sheets: XlsxSheet[]): Promise<Buffer> {
    const zip = new JSZip();
    const styleRegistry = createStyleRegistry(sheets);

    zip.file("[Content_Types].xml", createContentTypesXml(sheets.length));
    zip.folder("_rels")?.file(".rels", createRootRelsXml());
    zip.folder("docProps")?.file("core.xml", createCoreXml());
    zip.folder("docProps")?.file("app.xml", createAppXml(sheets));

    const xl = zip.folder("xl");
    xl?.file("workbook.xml", createWorkbookXml(sheets));
    xl?.file("styles.xml", styleRegistry.stylesXml);
    xl?.folder("_rels")?.file("workbook.xml.rels", createWorkbookRelsXml(sheets.length));
    const worksheets = xl?.folder("worksheets");
    sheets.forEach((sheet, index) => {
      worksheets?.file(`sheet${index + 1}.xml`, createWorksheetXml(sheet, styleRegistry));
    });

    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }
}

function createStyleRegistry(sheets: XlsxSheet[]): StyleRegistry {
  const fonts: XlsxCell[] = [{
    text: "",
    fontFamily: DEFAULT_FONT,
    fontSize: 11,
    color: DEFAULT_COLOR,
    bold: false,
    italic: false
  }];
  const fontKeyToId = new Map<string, number>([[fontKey(fonts[0]), 0]]);
  const styleKeyToId = new Map<string, number>();

  const ensureStyleId = (cell: XlsxCell): number => {
    const key = fontKey(cell);
    let fontId = fontKeyToId.get(key);
    if (fontId === undefined) {
      fontId = fonts.length;
      fontKeyToId.set(key, fontId);
      fonts.push(cell);
    }
    const styleKey = String(fontId);
    let styleId = styleKeyToId.get(styleKey);
    if (styleId === undefined) {
      styleId = styleKeyToId.size + 1;
      styleKeyToId.set(styleKey, styleId);
    }
    return styleId;
  };

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row.cells.values()) ensureStyleId(cell);
    }
  }

  return {
    stylesXml: createStylesXml(fonts, styleKeyToId),
    getStyleId: ensureStyleId
  };
}

function createWorksheetXml(sheet: XlsxSheet, styles: StyleRegistry): string {
  const maxRow = Math.max(1, ...sheet.rows.map((row) => row.index));
  const maxColumn = Math.max(1, ...sheet.columns.map((column) => column.index));
  const dimension = `A1:${columnName(maxColumn)}${maxRow}`;
  const cols = sheet.columns
    .map((column) => `<col min="${column.index}" max="${column.index}" width="${round(column.width)}" customWidth="1"/>`)
    .join("");
  const rows = sheet.rows.map((row) => {
    const cells = [...row.cells.entries()]
      .sort(([a], [b]) => a - b)
      .map(([columnIndex, cell]) => {
        const ref = `${columnName(columnIndex)}${row.index}`;
        return `<c r="${ref}" s="${styles.getStyleId(cell)}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.text)}</t></is></c>`;
      })
      .join("");
    return `<row r="${row.index}" ht="${round(row.height)}" customHeight="1">${cells}</row>`;
  }).join("");

  return [
    xmlHeader(),
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<dimension ref="${dimension}"/>`,
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`,
    `<sheetFormatPr defaultRowHeight="15"/>`,
    cols ? `<cols>${cols}</cols>` : "",
    `<sheetData>${rows}</sheetData>`,
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`,
    `</worksheet>`
  ].join("");
}

function createStylesXml(fonts: XlsxCell[], styleKeyToId: Map<string, number>): string {
  const fontXml = fonts.map((font) => [
    "<font>",
    font.bold ? "<b/>" : "",
    font.italic ? "<i/>" : "",
    `<sz val="${round(font.fontSize)}"/>`,
    `<color rgb="FF${normalizeHexColor(font.color)}"/>`,
    `<name val="${escapeXmlAttribute(font.fontFamily || DEFAULT_FONT)}"/>`,
    "<family val=\"2\"/>",
    "</font>"
  ].join("")).join("");

  const cellXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  [...styleKeyToId.entries()]
    .sort((a, b) => a[1] - b[1])
    .forEach(([fontId]) => {
      cellXfs.push(`<xf numFmtId="0" fontId="${fontId}" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`);
    });

  return [
    xmlHeader(),
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`,
    `<fonts count="${fonts.length}">${fontXml}</fonts>`,
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`,
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>`,
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`,
    `<cellXfs count="${cellXfs.length}">${cellXfs.join("")}</cellXfs>`,
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`,
    `<dxfs count="0"/>`,
    `<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>`,
    `</styleSheet>`
  ].join("");
}

function createWorkbookXml(sheets: XlsxSheet[]): string {
  const sheetXml = sheets.map((sheet, index) =>
    `<sheet name="${escapeXmlAttribute(sanitizeSheetName(sheet.name, index + 1))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  return `${xmlHeader()}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml}</sheets></workbook>`;
}

function createWorkbookRelsXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  return `${xmlHeader()}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function createContentTypesXml(sheetCount: number): string {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `${xmlHeader()}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function createRootRelsXml(): string {
  return `${xmlHeader()}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function createCoreXml(): string {
  const timestamp = new Date().toISOString();
  return `${xmlHeader()}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Convert Smith</dc:creator><cp:lastModifiedBy>Convert Smith</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`;
}

function createAppXml(sheets: XlsxSheet[]): string {
  const titles = sheets.map((sheet, index) => `<vt:lpstr>${escapeXml(sanitizeSheetName(sheet.name, index + 1))}</vt:lpstr>`).join("");
  return `${xmlHeader()}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Convert Smith</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts></Properties>`;
}

function refreshRowBucket(bucket: RowBucket): void {
  bucket.y = Math.min(...bucket.items.map((item) => item.y));
  bucket.bottom = Math.max(...bucket.items.map((item) => item.bottom));
  bucket.height = Math.max(1, bucket.bottom - bucket.y);
  bucket.centerY = bucket.items.reduce((sum, item) => sum + item.centerY, 0) / bucket.items.length;
}

function normalizeCellText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function joinCellText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (left.endsWith(" ") || right.startsWith(" ")) return `${left}${right}`;
  return `${left} ${right}`;
}

function fontKey(cell: XlsxCell): string {
  return [
    cell.fontFamily || DEFAULT_FONT,
    round(cell.fontSize),
    normalizeHexColor(cell.color),
    cell.bold ? "b" : "",
    cell.italic ? "i" : ""
  ].join("|");
}

function visualTextLength(text: string): number {
  let length = 0;
  for (const char of text) {
    length += /[\u3131-\u318e\uac00-\ud7a3\u3400-\u9fff]/.test(char) ? 1.8 : 1;
  }
  return length;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Math.max(8, visualTextLength(text) * Math.max(6, fontSize) * 0.5);
}

function columnName(index: number): string {
  let value = Math.max(1, Math.trunc(index));
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function sanitizeSheetName(name: string, fallbackIndex: number): string {
  const cleaned = name.replace(/[\[\]*?:/\\]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || `Sheet ${fallbackIndex}`).slice(0, MAX_SHEET_NAME_LENGTH);
}

function normalizeHexColor(value?: string): string {
  const normalized = (value || DEFAULT_COLOR).replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : DEFAULT_COLOR;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXml(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlHeader(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
