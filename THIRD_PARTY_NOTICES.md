# Third Party Notices

Convert Smith uses open source and third-party software. This notice is provided for attribution and license compliance. It is not legal advice.

The installed application package includes the following legal resources:

- `legal/EULA.txt`
- `legal/INSTALLER_EULA.txt`
- `legal/FFMPEG_SOURCE_OFFER.txt`
- `legal/PDFIUM_CHROMIUM_NOTICE.txt`
- `legal/licenses/`

## Runtime Components

| Component | Primary use in Convert Smith | License / notice location |
| --- | --- | --- |
| Electron | Desktop runtime, Chromium shell | MIT; see `legal/licenses/electron/LICENSE` |
| Chromium components | Browser engine used by Electron | See `legal/licenses/electron/LICENSES.chromium.html` |
| PDFium | Chromium PDF renderer used through Electron for PDF preview/rendering | BSD-style and Apache-2.0 portions; see `legal/PDFIUM_CHROMIUM_NOTICE.txt` and `legal/licenses/electron/LICENSES.chromium.html` |
| React | Renderer UI | MIT; see `legal/licenses/react/LICENSE` |
| React DOM | Renderer UI | MIT; see `legal/licenses/react-dom/LICENSE` |
| lucide-react | UI icons | ISC; see `legal/licenses/lucide-react/LICENSE` |
| FFmpeg | Local video/audio conversion | GPL/LGPL depending on bundled binary; see `legal/licenses/ffmpeg-static/` and `legal/FFMPEG_SOURCE_OFFER.txt` |
| FFprobe | Local media validation/inspection | FFmpeg project binary notice; see `legal/licenses/ffprobe-static/` and `legal/FFMPEG_SOURCE_OFFER.txt` |
| sharp | Local image conversion and image processing | Apache-2.0; see `legal/licenses/sharp/LICENSE` |
| heic-convert | HEIC/HEIF input decoding to JPG/PNG | ISC package declaration; see `legal/licenses/heic-convert/NOTICE.txt` |
| pdf-lib | PDF generation and PDF edits | MIT; see `legal/licenses/pdf-lib/LICENSE.md` |
| @pdf-lib/fontkit | Font embedding for PDF text output | MIT package declaration; see `legal/licenses/pdf-lib-fontkit/NOTICE.txt` |
| pdfjs-dist | PDF text/object parsing and fallback rendering | Apache-2.0; see `legal/licenses/pdfjs-dist/LICENSE` |
| @napi-rs/canvas | Local canvas rendering for PDF.js fallback paths | MIT; see `legal/licenses/napi-rs-canvas/LICENSE` |
| docx | DOCX creation for PDF to Word best-effort modes | MIT; see `legal/licenses/docx/LICENSE` |
| jszip | ZIP/Office validation and archive handling | MIT or GPLv3 dual license; see `legal/licenses/jszip/LICENSE.markdown` |

Development-only dependencies are not normally distributed as part of the packaged application. Their license information remains available in `package-lock.json` and the npm package metadata.

## FFmpeg / FFprobe

Convert Smith bundles FFmpeg through `ffmpeg-static` and FFprobe through `ffprobe-static`.

The bundled Windows FFmpeg binary currently installed in this project reports:

- FFmpeg 64-bit static Windows build from www.gyan.dev
- Version: 6.1.1-essentials_build-www.gyan.dev
- License: GPL v3
- Source code reference: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93

Bundled FFmpeg license/build information is included at:

```text
legal/licenses/ffmpeg-static/LICENSE
legal/licenses/ffmpeg-static/ffmpeg.exe.LICENSE
legal/licenses/ffmpeg-static/ffmpeg.exe.README
```

Bundled FFprobe package notices are included at:

```text
legal/licenses/ffprobe-static/LICENSE
legal/licenses/ffprobe-static/README.md
```

When distributing Convert Smith installers or binaries, keep the FFmpeg/FFprobe notices with the distribution and provide corresponding source code or a valid written source offer for the exact binaries distributed. Convert Smith includes this helper file:

```text
legal/FFMPEG_SOURCE_OFFER.txt
```

Suggested About text:

```text
This software uses FFmpeg and FFprobe. FFmpeg is a trademark of the FFmpeg project. FFmpeg/FFprobe components are distributed under their respective open source licenses. Source code and license information are available from https://ffmpeg.org/ and the notices included with this application.
```

## PDFium / Chromium PDF Renderer

Convert Smith uses Electron. Electron includes Chromium components. PDF preview and rendering paths can use Chromium's PDF renderer/PDFium through Electron.

PDFium copyright and license notices are covered by Chromium's third-party license inventory and by the PDFium project license. Convert Smith includes:

```text
legal/PDFIUM_CHROMIUM_NOTICE.txt
legal/licenses/electron/LICENSE
legal/licenses/electron/LICENSES.chromium.html
```

Suggested About text:

```text
This software uses Electron and Chromium components. PDF rendering may use PDFium, the PDF library used by Chromium. PDFium and Chromium components are distributed under their respective open source licenses and notices included with this application.
```

## HEIC / HEIF Decoding

Convert Smith can read HEIC/HEIF files and convert them to JPG or PNG through local libraries, including `heic-convert` and its transitive decoding dependencies.

Convert Smith does not support JPG/PNG to HEIC output and does not bundle `heif-enc`, x265, or another HEVC/H.265 encoder.

Suggested About text:

```text
This software can read HEIC/HEIF images through local open source libraries and convert them to JPG or PNG. Convert Smith does not provide HEIC encoding output.
```

## LibreOffice

LibreOffice is not bundled with Convert Smith. Convert Smith can call a user-installed LibreOffice `soffice` executable for DOCX/XLSX/PPTX conversion.

If you distribute LibreOffice together with Convert Smith in a future installer, include LibreOffice license information and source availability notices. LibreOffice is made available under the Mozilla Public License v2.0 and includes additional open source components.

Suggested UI text:

```text
DOCX/XLSX/PPTX conversion requires LibreOffice. LibreOffice is a separate open source office suite and is not included with Convert Smith.
```

## General Notice

Most npm packages include license information inside their package metadata and package files. For packaged desktop distributions, preserve third-party license notices and do not remove copyright notices from bundled dependencies.

If you bundle additional external command-line tools in a future distribution, include their license files and source-code offer files in the packaged application.
