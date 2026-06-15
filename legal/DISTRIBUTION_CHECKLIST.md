# Convert Smith Distribution Checklist

Use this checklist before uploading a public installer or portable build.

## Required for every public distribution

- Include `THIRD_PARTY_NOTICES.md`.
- Include `legal/EULA.txt`.
- Use `legal/INSTALLER_EULA.txt` for the NSIS installer license page.
- Include `legal/FFMPEG_SOURCE_OFFER.txt`.
- Include `legal/licenses/ffmpeg-static/*`.
- Include `legal/licenses/ffprobe-static/*`.
- Keep FFmpeg and FFprobe license/copyright notices intact.
- Do not add EULA terms that restrict open source component rights.

## FFmpeg / FFprobe

- Confirm the bundled FFmpeg/FFprobe binaries match the license files in
  `legal/licenses`.
- Provide corresponding source next to the binary release, or provide a valid
  written source offer.
- If the FFmpeg binary changes, refresh `legal/licenses/ffmpeg-static/*` from
  the installed package and update `legal/FFMPEG_SOURCE_OFFER.txt`.

## HEIC / HEIF

- Convert Smith supports HEIC/HEIF input conversion to JPG/PNG.
- Convert Smith does not support JPG/PNG to HEIC output.
- Do not add `heif-enc`, `x265`, or another HEIC/HEVC encoder without a
  separate license, source-notice, and patent review.

## LibreOffice

- LibreOffice is not bundled by default.
- If you bundle LibreOffice in the future, include LibreOffice license notices
  and source availability information.
