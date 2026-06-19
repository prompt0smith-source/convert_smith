import type { NativePdfTextSpan, ParsedPdfContentStream, PdfToken } from "./types.js";

export class PdfTextOperatorScanner {
  scan(streams: ParsedPdfContentStream[]): NativePdfTextSpan[] {
    const spans: NativePdfTextSpan[] = [];
    const pageSourceIndexes = new Map<number, number>();

    for (const stream of streams) {
      for (const operator of stream.operators) {
        if (operator.operator !== "Tj" && operator.operator !== "TJ") continue;

        const nextSourceIndex = pageSourceIndexes.get(stream.pageNumber) ?? 0;
        const span = this.createSpan(stream, operator.operatorIndex, nextSourceIndex);
        if (!span) continue;

        spans.push(span);
        pageSourceIndexes.set(stream.pageNumber, nextSourceIndex + 1);
      }
    }

    return spans;
  }

  private createSpan(
    stream: ParsedPdfContentStream,
    operatorIndex: number,
    sourceIndex: number
  ): NativePdfTextSpan | undefined {
    const operator = stream.operators[operatorIndex];
    if (operator.operator === "Tj") {
      const stringToken = operator.operands.find((token) => token.type === "literalString" || token.type === "hexString");
      if (!stringToken?.bytes || stringToken.decodedText === undefined) return undefined;
      const decodedText = stringToken.decodedText.normalize("NFC");
      if (!decodedText.trim()) return undefined;

      return {
        pageNumber: stream.pageNumber,
        sourceIndex,
        streamId: stream.streamId,
        streamIndex: stream.streamIndex,
        operatorIndex,
        operator: "Tj",
        rawOperator: operator.raw,
        decodedText,
        fontResourceName: operator.fontResourceName,
        fontSize: operator.fontSize,
        fillColor: operator.fillColor,
        transformMatrix: operator.transformMatrix,
        estimatedX: operator.estimatedX,
        estimatedY: operator.estimatedY,
        estimatedWidth: estimateTextWidth(decodedText, operator.fontSize),
        estimatedHeight: operator.estimatedHeight || operator.fontSize || 0,
        encodedKind: stringToken.type === "hexString" ? "hex" : "literal",
        encodedStart: stringToken.start,
        encodedEnd: stringToken.end,
        encodedBytes: stringToken.bytes
      };
    }

    const arrayToken = operator.operands.find((token) => token.type === "array");
    const stringTokens = arrayToken?.items?.filter((token) => token.type === "literalString" || token.type === "hexString") ?? [];
    const decodedText = stringTokens.map((token) => token.decodedText || "").join("").normalize("NFC");
    if (!decodedText.trim()) return undefined;

    return {
      pageNumber: stream.pageNumber,
      sourceIndex,
      streamId: stream.streamId,
      streamIndex: stream.streamIndex,
      operatorIndex,
      operator: "TJ",
      rawOperator: operator.raw,
      decodedText,
      fontResourceName: operator.fontResourceName,
      fontSize: operator.fontSize,
      fillColor: operator.fillColor,
      transformMatrix: operator.transformMatrix,
      estimatedX: operator.estimatedX,
      estimatedY: operator.estimatedY,
      estimatedWidth: estimateTextWidth(decodedText, operator.fontSize),
      estimatedHeight: operator.estimatedHeight || operator.fontSize || 0,
      encodedKind: "array",
      encodedStart: firstTokenStart(stringTokens, arrayToken),
      encodedEnd: lastTokenEnd(stringTokens, arrayToken),
      encodedBytes: concatTokenBytes(stringTokens)
    };
  }
}

function estimateTextWidth(text: string, fontSize = 10): number {
  return Math.round(text.length * fontSize * 0.55 * 100) / 100;
}

function firstTokenStart(tokens: PdfToken[], fallback?: PdfToken): number {
  return tokens[0]?.start ?? fallback?.start ?? 0;
}

function lastTokenEnd(tokens: PdfToken[], fallback?: PdfToken): number {
  return tokens[tokens.length - 1]?.end ?? fallback?.end ?? 0;
}

function concatTokenBytes(tokens: PdfToken[]): Uint8Array {
  const total = tokens.reduce((sum, token) => sum + (token.bytes?.length ?? 0), 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const token of tokens) {
    if (!token.bytes) continue;
    bytes.set(token.bytes, offset);
    offset += token.bytes.length;
  }
  return bytes;
}
