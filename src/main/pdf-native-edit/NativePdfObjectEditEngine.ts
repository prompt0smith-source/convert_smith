import type { PDFDocument } from "pdf-lib";
import type { PdfEditorEdit } from "../types/conversion.js";
import {
  createContentStreamStates,
  decodePdfNameToken,
  isOperandWord,
  tokenizePdfContent,
  type PdfContentStreamState,
  type PdfToken
} from "./PdfContentStreamParser.js";
import { PdfContentStreamWriter } from "./PdfContentStreamWriter.js";

interface NativeObjectEditResult {
  movedImageCount: number;
  duplicatedImageCount: number;
  deletedImageCount: number;
  movedLineCount: number;
  duplicatedLineCount: number;
  deletedLineCount: number;
  warnings: string[];
}

interface NumberOperand {
  value: number;
  token: PdfToken;
}

interface NativeImageDraw {
  id: string;
  pageNumber: number;
  streamIndex: number;
  resourceName: string;
  matrix: Matrix;
  cm?: {
    operands: NumberOperand[];
    preMatrix: Matrix;
  };
  nameToken: PdfToken;
  operatorToken: PdfToken;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NativeLineDraw {
  id: string;
  pageNumber: number;
  streamIndex: number;
  matrix: Matrix;
  startOperands: [NumberOperand, NumberOperand];
  endOperands: [NumberOperand, NumberOperand];
  rangeStart: number;
  rangeEnd: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface NativeObjectScan {
  streamStates: PdfContentStreamState[];
  images: NativeImageDraw[];
  lines: NativeLineDraw[];
}

type Matrix = [number, number, number, number, number, number];

const ID_MATCH_TOLERANCE = 0.01;
const IMAGE_GEOMETRY_TOLERANCE = 4;
const LINE_GEOMETRY_TOLERANCE = 3;

export class NativePdfObjectEditEngine {
  private readonly writer = new PdfContentStreamWriter();

  applyObjectEdits(pdfDoc: PDFDocument, edits: PdfEditorEdit[]): NativeObjectEditResult {
    const objectEdits = edits.filter((edit) => edit.action === "image" || edit.action === "line");
    const result: NativeObjectEditResult = {
      movedImageCount: 0,
      duplicatedImageCount: 0,
      deletedImageCount: 0,
      movedLineCount: 0,
      duplicatedLineCount: 0,
      deletedLineCount: 0,
      warnings: []
    };
    if (objectEdits.length === 0) return result;

    const scan = this.scanDocument(pdfDoc);
    const streamStateByKey = new Map(scan.streamStates.map((state) => [`${state.pageNumber}:${state.streamIndex}`, state]));

    for (const edit of objectEdits) {
      if (edit.action === "image") {
        const image = this.findImage(scan.images, edit);
        if (!image) throw new Error(createUnsupportedObjectMessage("image_not_found"));
        const state = streamStateByKey.get(`${image.pageNumber}:${image.streamIndex}`);
        if (!state) throw new Error(createUnsupportedObjectMessage("image_stream_not_found"));

        if (edit.objectEditMode === "delete") {
          state.patches.push({ start: image.nameToken.start, end: image.operatorToken.end, value: "" });
          result.deletedImageCount += 1;
          continue;
        }

        if (edit.objectEditMode === "duplicate") {
          const page = pdfDoc.getPage(edit.pageNumber - 1);
          const targetMatrix = createImageTargetMatrix(edit, page.getHeight());
          const localMatrix = multiplyMatrix(invertMatrix(image.matrix), targetMatrix);
          state.patches.push({
            start: image.operatorToken.end,
            end: image.operatorToken.end,
            value: `\nq ${localMatrix.map(formatPdfNumber).join(" ")} cm /${encodePdfName(image.resourceName)} Do Q\n`
          });
          result.duplicatedImageCount += 1;
          continue;
        }

        if (!image.cm) throw new Error(createUnsupportedObjectMessage("image_without_patchable_matrix"));
        const page = pdfDoc.getPage(edit.pageNumber - 1);
        const targetMatrix = createImageTargetMatrix(edit, page.getHeight());
        const localMatrix = multiplyMatrix(invertMatrix(image.cm.preMatrix), targetMatrix);
        image.cm.operands.forEach((operand, index) => {
          state.patches.push({
            start: operand.token.start,
            end: operand.token.end,
            value: formatPdfNumber(localMatrix[index])
          });
        });
        result.movedImageCount += 1;
        continue;
      }

      const line = this.findLine(scan.lines, edit);
      if (!line) throw new Error(createUnsupportedObjectMessage("line_not_found"));
      const state = streamStateByKey.get(`${line.pageNumber}:${line.streamIndex}`);
      if (!state) throw new Error(createUnsupportedObjectMessage("line_stream_not_found"));

      if (edit.objectEditMode === "delete") {
        state.patches.push({ start: line.rangeStart, end: line.rangeEnd, value: "" });
        result.deletedLineCount += 1;
        continue;
      }

      const page = pdfDoc.getPage(edit.pageNumber - 1);
      const inverse = invertMatrix(line.matrix);
      const nextStart = transformPoint(inverse, edit.x1 ?? edit.x, page.getHeight() - (edit.y1 ?? edit.y));
      const nextEnd = transformPoint(
        inverse,
        edit.x2 ?? edit.x + edit.width,
        page.getHeight() - (edit.y2 ?? edit.y + edit.height)
      );
      if (edit.objectEditMode === "duplicate") {
        state.patches.push({
          start: line.rangeEnd,
          end: line.rangeEnd,
          value: `\n${formatPdfNumber(nextStart[0])} ${formatPdfNumber(nextStart[1])} m ${formatPdfNumber(nextEnd[0])} ${formatPdfNumber(nextEnd[1])} l S\n`
        });
        result.duplicatedLineCount += 1;
        continue;
      }
      patchNumberOperand(state, line.startOperands[0], nextStart[0]);
      patchNumberOperand(state, line.startOperands[1], nextStart[1]);
      patchNumberOperand(state, line.endOperands[0], nextEnd[0]);
      patchNumberOperand(state, line.endOperands[1], nextEnd[1]);
      result.movedLineCount += 1;
    }

    this.writer.applyPatchedStreams(pdfDoc, scan.streamStates);
    if (
      result.movedImageCount ||
      result.duplicatedImageCount ||
      result.deletedImageCount ||
      result.movedLineCount ||
      result.duplicatedLineCount ||
      result.deletedLineCount
    ) {
      result.warnings.push("이미지/선 객체는 지원 가능한 PDF content stream 명령만 직접 패치했습니다. 흰 박스나 이미지 덮어쓰기는 사용하지 않았습니다.");
    }
    return result;
  }

  private scanDocument(pdfDoc: PDFDocument): NativeObjectScan {
    const streamStates: PdfContentStreamState[] = [];
    const images: NativeImageDraw[] = [];
    const lines: NativeLineDraw[] = [];

    pdfDoc.getPages().forEach((page, pageIndex) => {
      const pageNumber = pageIndex + 1;
      const pageHeight = page.getHeight();
      const pageStates = createContentStreamStates(page, pageNumber);
      streamStates.push(...pageStates);

      let imageOrder = 0;
      let lineOrder = 0;
      for (const state of pageStates) {
        const pageObjects = scanStreamObjects(state.content, pageNumber, state.streamIndex, pageHeight, imageOrder, lineOrder);
        images.push(...pageObjects.images);
        lines.push(...pageObjects.lines);
        imageOrder += pageObjects.images.length;
        lineOrder += pageObjects.lines.length;
      }
    });

    return { streamStates, images, lines };
  }

  private findImage(images: NativeImageDraw[], edit: PdfEditorEdit): NativeImageDraw | undefined {
    const byId = edit.nativeObjectId
      ? images.find((image) => image.id === edit.nativeObjectId && image.pageNumber === edit.pageNumber)
      : undefined;
    if (byId) return byId;
    return chooseSingleGeometryMatch(
      images.filter((image) => image.pageNumber === edit.pageNumber),
      (image) =>
        Math.abs(image.x - edit.x) +
        Math.abs(image.y - edit.y) +
        Math.abs(image.width - edit.width) +
        Math.abs(image.height - edit.height),
      IMAGE_GEOMETRY_TOLERANCE * 4
    );
  }

  private findLine(lines: NativeLineDraw[], edit: PdfEditorEdit): NativeLineDraw | undefined {
    const byId = edit.nativeObjectId
      ? lines.find((line) => line.id === edit.nativeObjectId && line.pageNumber === edit.pageNumber)
      : undefined;
    if (byId) return byId;
    const targetX1 = edit.x1 ?? edit.x;
    const targetY1 = edit.y1 ?? edit.y;
    const targetX2 = edit.x2 ?? edit.x + edit.width;
    const targetY2 = edit.y2 ?? edit.y + edit.height;
    return chooseSingleGeometryMatch(
      lines.filter((line) => line.pageNumber === edit.pageNumber),
      (line) =>
        Math.min(
          distance(line.x1, line.y1, targetX1, targetY1) + distance(line.x2, line.y2, targetX2, targetY2),
          distance(line.x1, line.y1, targetX2, targetY2) + distance(line.x2, line.y2, targetX1, targetY1)
        ),
      LINE_GEOMETRY_TOLERANCE * 2
    );
  }
}

function scanStreamObjects(
  content: string,
  pageNumber: number,
  streamIndex: number,
  pageHeight: number,
  imageOrderOffset: number,
  lineOrderOffset: number
): { images: NativeImageDraw[]; lines: NativeLineDraw[] } {
  const tokens = tokenizePdfContent(content);
  const operands: PdfToken[] = [];
  const matrixStack: Matrix[] = [];
  const images: NativeImageDraw[] = [];
  const lines: NativeLineDraw[] = [];
  let currentMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let lastCm: NativeImageDraw["cm"] | undefined;
  let currentMove: { operands: [NumberOperand, NumberOperand]; rangeStart: number; matrix: Matrix } | undefined;
  let pendingLine: Omit<NativeLineDraw, "id" | "pageNumber" | "streamIndex" | "rangeEnd"> | undefined;

  for (const token of tokens) {
    if (token.type !== "word" || isOperandWord(token.raw)) {
      operands.push(token);
      continue;
    }

    if (token.raw === "q") {
      matrixStack.push([...currentMatrix] as Matrix);
      clearPathState();
    } else if (token.raw === "Q") {
      currentMatrix = matrixStack.pop() || [1, 0, 0, 1, 0, 0];
      lastCm = undefined;
      clearPathState();
    } else if (token.raw === "cm") {
      const numbers = lastNumberOperands(operands, 6);
      if (numbers) {
        const localMatrix = numbers.map((operand) => operand.value) as Matrix;
        const preMatrix = [...currentMatrix] as Matrix;
        currentMatrix = multiplyMatrix(currentMatrix, localMatrix);
        lastCm = { operands: numbers, preMatrix };
      } else {
        lastCm = undefined;
      }
      clearPathState();
    } else if (token.raw === "Do") {
      const nameToken = [...operands].reverse().find((item) => item.type === "name");
      if (nameToken) {
        const image = createNativeImageDraw({
          id: `p${pageNumber}-image-${imageOrderOffset + images.length}`,
          pageNumber,
          streamIndex,
          pageHeight,
          resourceName: decodePdfNameToken(nameToken.raw),
          matrix: [...currentMatrix] as Matrix,
          cm: lastCm,
          nameToken,
          operatorToken: token
        });
        images.push(image);
      }
      clearPathState();
    } else if (token.raw === "m") {
      const numbers = lastNumberOperands(operands, 2);
      if (numbers) {
        currentMove = {
          operands: [numbers[0], numbers[1]],
          rangeStart: numbers[0].token.start,
          matrix: [...currentMatrix] as Matrix
        };
        pendingLine = undefined;
      } else {
        clearPathState();
      }
    } else if (token.raw === "l") {
      const numbers = lastNumberOperands(operands, 2);
      if (currentMove && numbers) {
        const start = toUiPoint(currentMove.matrix, currentMove.operands[0].value, currentMove.operands[1].value, pageHeight);
        const end = toUiPoint(currentMove.matrix, numbers[0].value, numbers[1].value, pageHeight);
        pendingLine = {
          matrix: currentMove.matrix,
          startOperands: currentMove.operands,
          endOperands: [numbers[0], numbers[1]],
          rangeStart: currentMove.rangeStart,
          x1: start[0],
          y1: start[1],
          x2: end[0],
          y2: end[1]
        };
      }
    } else if (token.raw === "S" || token.raw === "s") {
      if (pendingLine) {
        lines.push({
          ...pendingLine,
          id: `p${pageNumber}-line-${lineOrderOffset + lines.length}`,
          pageNumber,
          streamIndex,
          rangeEnd: token.end
        });
      }
      clearPathState();
    } else if (token.raw === "n" || token.raw === "f" || token.raw === "F" || token.raw === "B" || token.raw === "b") {
      clearPathState();
    }

    operands.length = 0;
  }

  return { images, lines };

  function clearPathState(): void {
    currentMove = undefined;
    pendingLine = undefined;
  }
}

function createNativeImageDraw(input: {
  id: string;
  pageNumber: number;
  streamIndex: number;
  pageHeight: number;
  resourceName: string;
  matrix: Matrix;
  cm?: NativeImageDraw["cm"];
  nameToken: PdfToken;
  operatorToken: PdfToken;
}): NativeImageDraw {
  const points = [
    transformPoint(input.matrix, 0, 0),
    transformPoint(input.matrix, 1, 0),
    transformPoint(input.matrix, 0, 1),
    transformPoint(input.matrix, 1, 1)
  ];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => input.pageHeight - point[1]);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    ...input,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function createImageTargetMatrix(edit: PdfEditorEdit, pageHeight: number): Matrix {
  const x = finiteNumber(edit.x, 0);
  const y = finiteNumber(edit.y, 0);
  const width = Math.max(0.1, finiteNumber(edit.width, 1));
  const height = Math.max(0.1, finiteNumber(edit.height, 1));
  return [width, 0, 0, height, x, pageHeight - y - height];
}

function patchNumberOperand(state: PdfContentStreamState, operand: NumberOperand, value: number): void {
  state.patches.push({
    start: operand.token.start,
    end: operand.token.end,
    value: formatPdfNumber(value)
  });
}

function chooseSingleGeometryMatch<T>(items: T[], score: (item: T) => number, maxScore: number): T | undefined {
  const ranked = items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score);
  if (!ranked.length || ranked[0].score > maxScore) return undefined;
  if (ranked[1] && Math.abs(ranked[0].score - ranked[1].score) <= ID_MATCH_TOLERANCE) return undefined;
  return ranked[0].item;
}

function lastNumberOperands(operands: PdfToken[], count: number): NumberOperand[] | undefined {
  const numbers = operands
    .filter((token) => token.type === "word" && isNumericWord(token.raw))
    .slice(-count)
    .map((token) => ({ value: Number(token.raw), token }));
  return numbers.length === count && numbers.every((item) => Number.isFinite(item.value)) ? numbers : undefined;
}

function isNumericWord(value: string): boolean {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value);
}

function toUiPoint(matrix: Matrix, x: number, y: number, pageHeight: number): [number, number] {
  const point = transformPoint(matrix, x, y);
  return [point[0], pageHeight - point[1]];
}

function transformPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function invertMatrix(matrix: Matrix): Matrix {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) < 1e-8) {
    throw new Error(createUnsupportedObjectMessage("non_invertible_transform"));
  }
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant
  ];
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

function formatPdfNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.abs(value) < 0.000001 ? 0 : value;
  return Number(rounded.toFixed(4)).toString();
}

function encodePdfName(value: string): string {
  return Array.from(value)
    .map((char) => {
      if (/^[A-Za-z0-9_.-]$/.test(char)) return char;
      return `#${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0").slice(-2)}`;
    })
    .join("");
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createUnsupportedObjectMessage(reason: string): string {
  const safeDetails: Record<string, string> = {
    image_not_found: "수정할 이미지 객체를 PDF 내부 content stream에서 안전하게 찾지 못했습니다.",
    image_stream_not_found: "이미지 객체가 들어 있는 PDF stream을 다시 찾지 못했습니다.",
    image_without_patchable_matrix: "이 이미지는 직접 수정 가능한 단순 배치 행렬(cm)을 찾지 못했습니다.",
    line_not_found: "수정할 선 객체를 PDF 내부 content stream에서 안전하게 찾지 못했습니다.",
    line_stream_not_found: "선 객체가 들어 있는 PDF stream을 다시 찾지 못했습니다.",
    non_invertible_transform: "PDF 객체의 좌표 변환 행렬을 안전하게 계산할 수 없습니다."
  };
  return [
    "이미지/선 객체의 직접 저장 편집은 아직 제한되어 있습니다.",
    "지원 가능한 단순 PDF native 명령이면 직접 수정하지만, 이 객체는 안전하게 패치하지 못했습니다.",
    safeDetails[reason] || reason,
    "흰 박스나 이미지 덮어쓰기 방식은 사용하지 않았고 원본 파일은 변경하지 않았습니다."
  ].join("\n");

  const details: Record<string, string> = {
    image_not_found: "수정할 이미지 객체를 PDF 내부 content stream에서 안전하게 찾지 못했습니다.",
    image_stream_not_found: "이미지 객체가 들어 있는 PDF stream을 다시 찾지 못했습니다.",
    image_without_patchable_matrix: "이 이미지는 직접 수정 가능한 단순 배치 행렬(cm)을 찾지 못했습니다.",
    line_not_found: "수정할 선 객체를 PDF 내부 content stream에서 안전하게 찾지 못했습니다.",
    line_stream_not_found: "선 객체가 들어 있는 PDF stream을 다시 찾지 못했습니다.",
    non_invertible_transform: "PDF 객체의 좌표 변환 행렬을 안전하게 계산할 수 없습니다."
  };
  return [
    "이미지/선 객체의 직접 저장 편집은 아직 제한되어 있습니다.",
    "지원 가능한 단순 PDF native 명령이면 직접 수정하지만, 이 객체는 안전하게 패치하지 못했습니다.",
    details[reason] || reason,
    "흰 박스나 이미지 덮어쓰기 방식은 사용하지 않았고 원본 파일은 변경하지 않았습니다."
  ].join("\n");
}

function createUnsupportedObjectMessageLegacy(reason: string): string {
  const details: Record<string, string> = {
    image_not_found: "수정할 이미지 객체를 PDF 내부 content stream에서 안전하게 찾지 못했습니다.",
    image_stream_not_found: "이미지 객체가 들어 있는 PDF stream을 다시 찾지 못했습니다.",
    image_without_patchable_matrix: "이 이미지는 직접 수정 가능한 단순 배치 행렬(cm)을 찾지 못했습니다.",
    line_not_found: "수정할 선 객체를 PDF 내부 content stream에서 안전하게 찾지 못했습니다.",
    line_stream_not_found: "선 객체가 들어 있는 PDF stream을 다시 찾지 못했습니다.",
    non_invertible_transform: "PDF 객체의 좌표 변환 행렬을 안전하게 계산할 수 없습니다."
  };
  return [
    "이미지/선 객체의 직접 저장 편집은 아직 제한되어 있습니다.",
    "지원 가능한 단순 PDF native 명령이면 직접 수정하지만, 이 객체는 안전하게 패치하지 못했습니다.",
    details[reason] || reason,
    "흰 박스나 이미지 덮어쓰기 방식은 사용하지 않았고, 원본 파일은 변경하지 않았습니다."
  ].join("\n");
}
