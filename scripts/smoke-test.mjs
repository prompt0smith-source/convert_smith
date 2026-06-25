import path from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ffmpegPath from "ffmpeg-static";
import { ConversionService } from "../dist-electron/main/services/ConversionService.js";
import { PdfEditorService } from "../dist-electron/main/services/PdfEditorService.js";
import { PdfToolService } from "../dist-electron/main/services/PdfToolService.js";

const root = path.resolve("tmp-smoke");
const options = {
  imageQuality: 90,
  pdfImageFormat: "jpg",
  pdfRenderScale: 2,
  pdfPageSize: "auto",
  pdfToDocxMode: "editable_text",
  videoCompatibilityMode: true,
  overwritePolicy: "increment",
  sortMode: "basic"
};

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const pngInput = path.join(root, "sample.png");
await sharp({
  create: {
    width: 32,
    height: 32,
    channels: 4,
    background: { r: 31, g: 142, b: 101, alpha: 1 }
  }
})
  .png()
  .toFile(pngInput);

const service = new ConversionService();
const pngPreview = await service.getFilePreview(pngInput);
assertPreview("PNG preview", pngPreview);

const emptyInput = path.join(root, "empty.png");
await writeFile(emptyInput, Buffer.alloc(0));
await assertRejects("empty file failure", () =>
  service.convert(
    {
      sourcePaths: [emptyInput],
      outputDir: root,
      conversionType: "png_to_jpg",
      options
    },
    () => undefined
  )
);

const pngJob = await service.convert(
  {
    sourcePaths: [pngInput],
    outputDir: root,
    conversionType: "png_to_jpg",
    options
  },
  () => undefined
);
assertSuccess("PNG -> JPG", pngJob);

const webpJob = await service.convert(
  {
    sourcePaths: [pngInput],
    outputDir: root,
    conversionType: "image_to_webp",
    options
  },
  () => undefined
);
assertSuccess("PNG -> WEBP", webpJob);

const jpgInput = path.join(root, "sample.jpg");
await sharp(pngInput).jpeg({ quality: 95 }).toFile(jpgInput);
const jpgOptimizeJob = await service.convert(
  {
    sourcePaths: [jpgInput],
    outputDir: root,
    conversionType: "jpg_optimize",
    options: { ...options, imageQuality: 75 }
  },
  () => undefined
);
assertSuccess("JPG optimize", jpgOptimizeJob);

const pngOptimizeJob = await service.convert(
  {
    sourcePaths: [pngInput],
    outputDir: root,
    conversionType: "png_optimize",
    options
  },
  () => undefined
);
assertSuccess("PNG optimize", pngOptimizeJob);

const webpInput = path.join(root, "sample.webp");
await sharp(pngInput).webp({ quality: 95 }).toFile(webpInput);
const webpOptimizeJob = await service.convert(
  {
    sourcePaths: [webpInput],
    outputDir: root,
    conversionType: "webp_optimize",
    options: { ...options, imageQuality: 75 }
  },
  () => undefined
);
assertSuccess("WEBP optimize", webpOptimizeJob);

const pdfInput = path.join(root, "sample.pdf");
const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([360, 220]);
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
page.drawText("Convert Smith PDF Preview", {
  x: 36,
  y: 120,
  size: 18,
  font,
  color: rgb(0.1, 0.35, 0.25)
});
await writeFile(pdfInput, await pdfDoc.save());
const pdfPreview = await service.getFilePreview(pdfInput);
assertPreview("PDF preview", pdfPreview);

const pdfEditorService = new PdfEditorService();
const pdfEditorLayer = await pdfEditorService.getTextLayer(pdfInput);
const pdfEditorItem = pdfEditorLayer.items.find((item) => item.text === "Convert Smith PDF Preview");
if (!pdfEditorItem) {
  throw new Error("PDF editor smoke could not find editable source text.");
}
const pdfEditorResult = await pdfEditorService.saveTextEdits({
  sourcePath: pdfInput,
  outputDir: root,
  outputName: "pdf_editor_smoke",
  edits: [
    {
      action: "replace",
      pageNumber: pdfEditorItem.pageNumber,
      sourceIndex: pdfEditorItem.sourceIndex,
      nativeSpanId: pdfEditorItem.nativeSpanId,
      saveMode: "direct_replace",
      originalText: pdfEditorItem.text,
      replacementText: "Convert Smith PDF Edited",
      originalX: pdfEditorItem.x,
      originalY: pdfEditorItem.y,
      originalWidth: pdfEditorItem.width,
      originalHeight: pdfEditorItem.height,
      x: pdfEditorItem.x,
      y: pdfEditorItem.y,
      width: pdfEditorItem.width,
      height: pdfEditorItem.height,
      fontSize: pdfEditorItem.fontSize,
      fontFamily: pdfEditorItem.fontFamily,
      fontWeight: pdfEditorItem.fontWeight,
      fontStyle: pdfEditorItem.fontStyle,
      color: pdfEditorItem.color
    }
  ]
});
const pdfEditorSavedLayer = await pdfEditorService.getTextLayer(pdfEditorResult.outputPath);
const pdfEditorSavedText = pdfEditorSavedLayer.items.map((item) => item.text).join("\n");
if (!pdfEditorSavedText.includes("Convert Smith PDF Edited")) {
  throw new Error("PDF editor smoke did not persist direct text edits.");
}

const fakePdfInput = path.join(root, "fake.pdf");
await writeFile(fakePdfInput, Buffer.from("not a real pdf"));
const fakePdfJob = await service.convert(
  {
    sourcePaths: [fakePdfInput],
    outputDir: root,
    conversionType: "pdf_to_images",
    options: { ...options, outputName: "fake_pdf_failure" }
  },
  () => undefined
);
assertFailed("fake PDF failure", fakePdfJob);
await assertNoFilesStartingWith("failed jobs do not leave incomplete output files", "fake_pdf_failure");

const readingOrderPdfInput = path.join(root, "reading-order.pdf");
const readingOrderPdf = await PDFDocument.create();
const readingOrderPage = readingOrderPdf.addPage([360, 220]);
readingOrderPage.drawText("RIGHT", { x: 190, y: 130, size: 16, font });
readingOrderPage.drawText("LEFT", { x: 36, y: 130, size: 16, font });
readingOrderPage.drawText("BOTTOM", { x: 36, y: 80, size: 16, font });
await writeFile(readingOrderPdfInput, await readingOrderPdf.save());

const readingOrderJob = await service.convert(
  {
    sourcePaths: [readingOrderPdfInput],
    outputDir: root,
    conversionType: "pdf_to_docx",
    options: { ...options, pdfToDocxMode: "editable_text" }
  },
  () => undefined
);
assertSuccess("PDF -> DOCX reading order", readingOrderJob);
const readingOrderText = await readDocxText(readingOrderJob.outputPaths[0]);
assertTextOrder("PDF -> DOCX reading order", readingOrderText, ["LEFT", "RIGHT", "BOTTOM"]);

const xlsxJob = await service.convert(
  {
    sourcePaths: [readingOrderPdfInput],
    outputDir: root,
    conversionType: "pdf_to_xlsx",
    options
  },
  () => undefined
);
assertSuccess("PDF -> XLSX table reconstruction", xlsxJob);
const xlsxSheetXml = await read("tar", ["-xOf", xlsxJob.outputPaths[0], "xl/worksheets/sheet1.xml"]);
if (!readInlineXlsxText(xlsxSheetXml).includes("LEFT") || !readInlineXlsxText(xlsxSheetXml).includes("RIGHT")) {
  throw new Error("PDF -> XLSX did not keep selectable PDF text.");
}

const layeredPdfInput = path.join(root, "layered-text-image.pdf");
const layeredPdf = await PDFDocument.create();
const layeredPage = layeredPdf.addPage([360, 220]);
const embeddedPng = await layeredPdf.embedPng(await readFile(pngInput));
layeredPage.drawImage(embeddedPng, { x: 36, y: 82, width: 64, height: 64 });
layeredPage.drawText("SELECTABLE TEXT", {
  x: 120,
  y: 112,
  size: 16,
  font,
  color: rgb(0, 0, 0)
});
layeredPage.drawText("GREEN", {
  x: 120,
  y: 88,
  size: 16,
  font,
  color: rgb(56 / 255, 166 / 255, 40 / 255)
});
await writeFile(layeredPdfInput, await layeredPdf.save());

const layeredJob = await service.convert(
  {
    sourcePaths: [layeredPdfInput],
    outputDir: root,
    conversionType: "pdf_to_docx",
    options: { ...options, pdfToDocxMode: "visual_preservation" }
  },
  () => undefined
);
assertSuccess("PDF -> DOCX text/image separation", layeredJob);
const layeredXml = await readDocxXml(layeredJob.outputPaths[0]);
if (!readDocxTextFromXml(layeredXml).includes("SELECTABLE TEXT")) {
  throw new Error("PDF -> DOCX text/image separation did not keep selectable text.");
}
if ((layeredXml.match(/r:embed=/g) || []).length < 1) {
  throw new Error("PDF -> DOCX text/image separation did not keep PDF image objects.");
}
if (layeredXml.includes("w:vanish")) {
  throw new Error("PDF -> DOCX text/image separation created hidden text instead of visible text.");
}
if (!layeredXml.includes('w:val="38A628"')) {
  throw new Error("PDF -> DOCX text/image separation did not keep PDF text color.");
}
assertDocxFonts("PDF -> DOCX local font matching", layeredXml);

const pdfInputTwo = path.join(root, "sample-two.pdf");
const pdfDocTwo = await PDFDocument.create();
const secondPage = pdfDocTwo.addPage([240, 180]);
secondPage.drawText("Second PDF", { x: 30, y: 90, size: 16, font });
await writeFile(pdfInputTwo, await pdfDocTwo.save());

const pdfToolService = new PdfToolService();
const pdfInfo = await pdfToolService.getInfo(pdfInput);
if (pdfInfo.pageCount !== 1) {
  throw new Error(`PDF info returned unexpected page count: ${pdfInfo.pageCount}`);
}
const mergeJob = await pdfToolService.run(
  {
    sourcePaths: [pdfInput, pdfInputTwo],
    outputDir: root,
    toolType: "pdf_merge",
    options: { outputName: "merged_smoke" }
  },
  () => undefined
);
assertSuccess("PDF merge", mergeJob);

const splitJob = await pdfToolService.run(
  {
    sourcePaths: [mergeJob.outputPaths[0]],
    outputDir: root,
    toolType: "pdf_split_all",
    options: {}
  },
  () => undefined
);
assertSuccess("PDF split all", splitJob);
if (splitJob.outputPaths.length !== 2) {
  throw new Error(`PDF split expected 2 files, got ${splitJob.outputPaths.length}`);
}
const splitNames = splitJob.outputPaths.map((outputPath) => path.basename(outputPath));
if (!splitNames.includes("merged_smoke(1).pdf") || !splitNames.includes("merged_smoke(2).pdf")) {
  throw new Error(`PDF split default naming was wrong: ${splitNames.join(", ")}`);
}

const signatureImageInput = path.join(root, "signature.png");
await sharp({
  create: {
    width: 120,
    height: 48,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 0 }
  }
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="120" height="48" xmlns="http://www.w3.org/2000/svg"><path d="M8 34 C28 4, 36 46, 58 20 S92 14, 112 28" fill="none" stroke="#087f5b" stroke-width="5" stroke-linecap="round"/></svg>`
      )
    }
  ])
  .png()
  .toFile(signatureImageInput);
const signatureJob = await pdfToolService.run(
  {
    sourcePaths: [pdfInput],
    outputDir: root,
    toolType: "pdf_signature_stamp",
    options: {
      outputName: "signed_smoke",
      signatureStamp: {
        signatureImagePath: signatureImageInput,
        pages: [1],
        placement: {
          xPercent: 60,
          yPercent: 70,
          widthPercent: 25,
          keepAspectRatio: true
        },
        opacity: 0.9,
        flattenSignedPages: false,
        renderScale: 2
      }
    }
  },
  () => undefined
);
assertSuccess("PDF signature stamp", signatureJob);

const mp4Input = path.join(root, "sample.mp4");
await run(ffmpegPath, [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=64x64:rate=5",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=1000:duration=1",
  "-t",
  "1",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  mp4Input
]);

const mp3Job = await service.convert(
  {
    sourcePaths: [mp4Input],
    outputDir: root,
    conversionType: "mp4_to_mp3",
    options
  },
  () => undefined
);
assertSuccess("MP4 -> MP3", mp3Job);

const gifJob = await service.convert(
  {
    sourcePaths: [mp4Input],
    outputDir: root,
    conversionType: "video_to_gif",
    options: { ...options, gifResolution: "240" }
  },
  () => undefined
);
assertSuccess("Video -> GIF", gifJob);

const webmInput = path.join(root, "sample.webm");
await run(ffmpegPath, [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=64x64:rate=5",
  "-t",
  "1",
  "-c:v",
  "libvpx-vp9",
  webmInput
]);

const webmJob = await service.convert(
  {
    sourcePaths: [webmInput],
    outputDir: root,
    conversionType: "webm_to_mp4",
    options
  },
  () => undefined
);
assertSuccess("WEBM -> MP4", webmJob);

console.log("Smoke test passed");
console.log(`PNG -> JPG: ${pngJob.outputPaths[0]}`);
console.log(`PNG -> WEBP: ${webpJob.outputPaths[0]}`);
console.log(`JPG optimize: ${jpgOptimizeJob.outputPaths[0]}`);
console.log(`PNG optimize: ${pngOptimizeJob.outputPaths[0]}`);
console.log(`WEBP optimize: ${webpOptimizeJob.outputPaths[0]}`);
console.log(`PDF -> DOCX reading order: ${readingOrderJob.outputPaths[0]}`);
console.log(`PDF -> XLSX table reconstruction: ${xlsxJob.outputPaths[0]}`);
console.log(`PDF -> DOCX text/image separation: ${layeredJob.outputPaths[0]}`);
console.log(`PDF editor direct text save: ${pdfEditorResult.outputPath}`);
console.log(`PDF merge: ${mergeJob.outputPaths[0]}`);
console.log(`PDF split files: ${splitJob.outputPaths.length}`);
console.log(`PDF signature stamp: ${signatureJob.outputPaths[0]}`);
console.log(`MP4 -> MP3: ${mp3Job.outputPaths[0]}`);
console.log(`Video -> GIF: ${gifJob.outputPaths[0]}`);
console.log(`WEBM -> MP4: ${webmJob.outputPaths[0]}`);

async function assertSuccess(label, job) {
  if (job.status !== "success") {
    throw new Error(`${label} failed: ${job.error || job.message}`);
  }
  assertResultReport(label, job, true);
  for (const outputPath of job.outputPaths) {
    const info = await stat(outputPath);
    if (info.size <= 0) {
      throw new Error(`${label} produced an empty output: ${outputPath}`);
    }
  }
}

function assertFailed(label, job) {
  if (job.status !== "failed") {
    throw new Error(`${label} expected failure, got ${job.status}.`);
  }
  assertResultReport(label, job, false);
  if (job.outputPaths.length !== 0) {
    throw new Error(`${label} kept output paths after failure: ${job.outputPaths.join(", ")}`);
  }
}

function assertResultReport(label, job, expectedValidationPassed) {
  if (!job.resultReport) {
    throw new Error(`${label} did not include a result report.`);
  }
  if (job.resultReport.validationPassed !== expectedValidationPassed) {
    throw new Error(`${label} result report validation flag was wrong.`);
  }
  if (job.resultReport.sourceCount < 1) {
    throw new Error(`${label} result report did not count source files.`);
  }
  if (job.resultReport.durationMs < 0) {
    throw new Error(`${label} result report duration was invalid.`);
  }
  if (!Number.isFinite(job.resultReport.byteDelta) || !Number.isFinite(job.resultReport.byteDeltaPercent)) {
    throw new Error(`${label} result report did not include a valid byte difference.`);
  }
  if (expectedValidationPassed && job.resultReport.outputCount !== job.outputPaths.length) {
    throw new Error(`${label} result report output count was invalid.`);
  }
}

async function assertRejects(label, run) {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

async function assertNoFilesStartingWith(label, prefix) {
  const files = await readdir(root);
  const leaked = files.filter((file) => file.startsWith(prefix));
  if (leaked.length > 0) {
    throw new Error(`${label}: ${leaked.join(", ")}`);
  }
}

function assertPreview(label, preview) {
  if (!preview.dataUrl || !preview.dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error(`${label} did not produce an image data URL.`);
  }
}

function assertTextOrder(label, text, orderedNeedles) {
  let previousIndex = -1;
  for (const needle of orderedNeedles) {
    const index = text.indexOf(needle);
    if (index <= previousIndex) {
      throw new Error(`${label} produced wrong text order. Expected ${orderedNeedles.join(" -> ")}, got: ${text}`);
    }
    previousIndex = index;
  }
}

async function readDocxText(docxPath) {
  const xml = await readDocxXml(docxPath);
  return readDocxTextFromXml(xml);
}

async function readDocxXml(docxPath) {
  return read("tar", ["-xOf", docxPath, "word/document.xml"]);
}

function readDocxTextFromXml(xml) {
  return [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("\n");
}

function readInlineXlsxText(xml) {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("\n");
}

function assertDocxFonts(label, xml) {
  const fontElements = [...xml.matchAll(/<w:rFonts\b[^>]*>/g)].map((match) => match[0]);
  if (fontElements.length < 1) {
    throw new Error(`${label} did not write DOCX run font information.`);
  }

  const fontNames = new Set(
    [...xml.matchAll(/w:(?:ascii|hAnsi|eastAsia|cs)="([^"]+)"/g)].map((match) => match[1])
  );
  if (fontNames.size < 1) {
    throw new Error(`${label} wrote empty DOCX run font information.`);
  }
  if (fontNames.has("sans-serif")) {
    throw new Error(`${label} kept a generic PDF.js font family instead of a local/fallback font.`);
  }
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function read(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
