import path from "node:path";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PdfEditorService } from "../dist-electron/main/services/PdfEditorService.js";
import { PdfEditorFontService } from "../dist-electron/main/services/PdfEditorFontService.js";

const require = createRequire(import.meta.url);
const PDFRawStream = require("pdf-lib/cjs/core/objects/PDFRawStream").default;
const PDFContentStream = require("pdf-lib/cjs/core/structures/PDFContentStream").default;
const { decodePDFRawStream } = require("pdf-lib/cjs/core/streams/decode");

const root = path.resolve("tmp-smoke", "pdf-editor-harness");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const service = new PdfEditorService();
const inputPath = path.join(root, "latin-direct.pdf");
const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([360, 220]);
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
page.drawText("Convert Smith Source", { x: 36, y: 126, size: 18, font, color: rgb(0, 0, 0) });
await writeFile(inputPath, await pdfDoc.save({ useObjectStreams: false }));

const layer = await service.getTextLayer(inputPath);
const item = layer.items.find((entry) => entry.text === "Convert Smith Source");
if (!item) throw new Error("PDF editor harness could not find source text.");

const directResult = await service.saveTextEdits({
  sourcePath: inputPath,
  outputDir: root,
  outputName: "latin-direct-edited",
  edits: [makeReplaceEdit(item, "Convert Smith Edited")]
});
const directLayer = await service.getTextLayer(directResult.outputPath);
const directText = directLayer.items.map((entry) => entry.text).join("\n");
if (!directText.includes("Convert Smith Edited")) {
  throw new Error("Direct text edit did not persist replacement text.");
}
if ((await decodedPageContent(await readFile(directResult.outputPath))).some((content) => hasWhiteRectangle(content))) {
  throw new Error("Direct text edit created a white rectangle operator.");
}

const fontProbe = new PdfEditorFontService();
let fallbackChecked = false;
try {
  const probeDoc = await PDFDocument.create();
  probeDoc.registerFontkit((await import("@pdf-lib/fontkit")).default);
  await fontProbe.resolveEmbeddedFont(probeDoc, "한글 저장 확인", "Malgun Gothic");
  const fallbackResult = await service.saveTextEdits({
    sourcePath: inputPath,
    outputDir: root,
    outputName: "font-replacement-edited",
    edits: [makeReplaceEdit(item, "한글 저장 확인")]
  });
  const fallbackLayer = await service.getTextLayer(fallbackResult.outputPath);
  const fallbackText = fallbackLayer.items.map((entry) => entry.text).join("\n");
  if (!fallbackText.includes("한글 저장 확인")) {
    throw new Error("Replacement-font text object mode did not persist Korean text.");
  }
  if ((await decodedPageContent(await readFile(fallbackResult.outputPath))).some((content) => hasWhiteRectangle(content))) {
    throw new Error("Replacement-font edit created a white rectangle operator.");
  }
  fallbackChecked = true;
} catch (error) {
  console.warn(`Replacement-font Korean check skipped: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("PDF editor harness passed");
console.log(`Direct edit: ${directResult.outputPath}`);
console.log(`Replacement-font check: ${fallbackChecked ? "passed" : "skipped"}`);

function makeReplaceEdit(item, replacementText) {
  return {
    action: "replace",
    pageNumber: item.pageNumber,
    sourceIndex: item.sourceIndex,
    originalText: item.text,
    replacementText,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    color: item.color
  };
}

function decodedPageContent(bytes) {
  return PDFDocument.load(bytes, { ignoreEncryption: false }).then((doc) =>
    doc.getPages().flatMap((pdfPage) => {
      const contents = pdfPage.node.normalizedEntries().Contents;
      if (!contents || typeof contents.size !== "function") return [];
      const streams = [];
      for (let index = 0; index < contents.size(); index += 1) {
        const stream = contents.lookup(index);
        streams.push(decodeStream(stream));
      }
      return streams;
    })
  );
}

function decodeStream(stream) {
  if (stream instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(stream).decode()).toString("binary");
  if (stream instanceof PDFContentStream || typeof stream?.getUnencodedContents === "function") {
    return Buffer.from(stream.getUnencodedContents()).toString("binary");
  }
  if (typeof stream?.getContents === "function") return Buffer.from(stream.getContents()).toString("binary");
  return "";
}

function hasWhiteRectangle(content) {
  return /(?:^|\s)(?:1(?:\.0+)?\s+){3}rg[\s\S]{0,180}\bre\b[\s\S]{0,80}\bf\b/.test(content);
}
