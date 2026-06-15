# Third Party Notices

Convert Smith uses open source software. This notice is provided for attribution and license compliance. It is not legal advice.

Installed distributions include additional legal files in the application
resources folder:

- `legal/EULA.txt`
- `legal/INSTALLER_EULA.txt`
- `legal/FFMPEG_SOURCE_OFFER.txt`
- `legal/licenses/ffmpeg-static/`
- `legal/licenses/ffprobe-static/`

## Runtime Dependencies

| Package | License |
| --- | --- |
| Electron | MIT |
| React | MIT |
| React DOM | MIT |
| lucide-react | ISC |
| ffmpeg-static | GPL-3.0-or-later |
| ffprobe-static | MIT package; includes FFprobe/FFmpeg binary components |
| sharp | Apache-2.0 |
| heic-convert | ISC |
| libheif-js, via heic-convert | LGPL-3.0 |
| pdf-lib | MIT |
| pdfjs-dist | Apache-2.0 |
| @napi-rs/canvas | MIT |
| docx | MIT |

## Development Dependencies

| Package | License |
| --- | --- |
| Vite | MIT |
| @vitejs/plugin-react | MIT |
| TypeScript | Apache-2.0 |
| Tailwind CSS | MIT |
| PostCSS | MIT |
| Autoprefixer | MIT |
| electron-builder | MIT |
| concurrently | MIT |
| wait-on | MIT |
| @types/node | MIT |
| @types/react | MIT |
| @types/react-dom | MIT |

## FFmpeg / FFprobe

Convert Smith bundles FFmpeg through `ffmpeg-static` and FFprobe through `ffprobe-static`.

The installed `ffmpeg-static` package is licensed as GPL-3.0-or-later and includes the GPL license text in:

```text
node_modules/ffmpeg-static/LICENSE
node_modules/ffmpeg-static/ffmpeg.exe.LICENSE
legal/licenses/ffmpeg-static/LICENSE
legal/licenses/ffmpeg-static/ffmpeg.exe.LICENSE
legal/licenses/ffmpeg-static/ffmpeg.exe.README
```

FFmpeg itself may be LGPL or GPL depending on build options. Convert Smith uses FFmpeg command-line executables via `child_process.spawn`.

When distributing Convert Smith installers or binaries, keep the FFmpeg/FFprobe license files with the distribution and provide the corresponding FFmpeg source or a written source offer that matches the binary being distributed. Convert Smith includes a distribution helper notice at `legal/FFMPEG_SOURCE_OFFER.txt`.

Suggested About text:

```text
This software uses FFmpeg and FFprobe. FFmpeg is a trademark of the FFmpeg project. FFmpeg/FFprobe components are distributed under their respective open source licenses. Source code and license information are available from https://ffmpeg.org/ and the notices included with this application.
```

## HEIC / HEIF Decoding

Convert Smith can read HEIC/HEIF files and convert them to JPG or PNG through local image libraries, including `heic-convert` and its transitive `libheif-js` dependency.

Convert Smith does not support JPG/PNG to HEIC output and does not bundle `heif-enc`, x265, or another HEVC/H.265 encoder.

Suggested About text:

```text
This software can read HEIC/HEIF images through local open source libraries and convert them to JPG or PNG. Convert Smith does not provide HEIC encoding output.
```

## LibreOffice

LibreOffice is not bundled with Convert Smith. Convert Smith can call a user-installed LibreOffice `soffice` executable for DOCX/XLSX to PDF conversion.

If you distribute LibreOffice together with Convert Smith in a future installer, include LibreOffice license information and source availability notices. LibreOffice is made available under the Mozilla Public License v2.0 and includes additional open source components.

Suggested UI text:

```text
DOCX/XLSX → PDF conversion requires LibreOffice. LibreOffice is a separate open source office suite and is not included with Convert Smith.
```

## License Files

Most npm packages include their license files inside `node_modules`. For packaged desktop distributions, preserve third-party license notices and do not remove copyright notices from bundled dependencies.

If you bundle additional external command-line tools in a future distribution, include their license files and source-code offer files in the packaged application.
