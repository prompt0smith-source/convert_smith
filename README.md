# Convert Smith

Convert Smith는 확장자만 바꾸지 않고, 실제로 열리는 파일로 변환하는 로컬 우선 데스크톱 파일 변환 앱입니다.

모든 MVP 변환은 사용자의 PC에서 실행됩니다. 클라우드 업로드, 로그인, 결제, 온라인 변환 API는 사용하지 않습니다.

## 주요 기능

- PDF -> Word / DOCX
- Word / DOCX -> PDF
- JPG / PNG -> PDF
- PDF -> JPG / PNG
- HEIC -> JPG / PNG
- PNG <-> JPG, JPG/PNG/WEBP 최적화
- MP4 -> MP3
- MOV -> MP4
- 동영상 호환성 복구 MP4
- Excel / XLSX -> PDF
- PDF 병합, 분할, 페이지 정렬, 페이지 회전
- PDF 서명 스탬프 추가
- PDF 편집기 실험 모드

## 단순 확장자 변경이 아닌 이유

파일 확장자만 바꾸면 내부 구조, 컨테이너, 코덱, 문서 포맷은 바뀌지 않습니다.

Convert Smith는 변환 엔진을 통해 새 출력 파일을 생성하고, 가능한 범위에서 파일 시그니처와 결과 파일 검증을 수행합니다. 예를 들어 동영상 호환성 복구는 MP4 확장자만 붙이는 것이 아니라 H.264, AAC, yuv420p, faststart 설정으로 다시 인코딩합니다.

## 설치 및 실행

```bash
npm install
npm run dev
```

일반 실행:

```bash
npm start
```

빌드:

```bash
npm run build
```

설치 마법사 생성:

```bash
npm run dist
```

스모크 테스트:

```bash
npm run smoke
```

## LibreOffice 안내

DOCX, XLSX, PPTX 계열 문서를 PDF로 변환하려면 LibreOffice가 필요합니다. Convert Smith는 LibreOffice를 기본 동봉하지 않습니다.

앱의 설정에서 `soffice.exe` 경로를 지정할 수 있습니다.

Windows 기본 후보:

```text
C:\Program Files\LibreOffice\program\soffice.exe
C:\Program Files (x86)\LibreOffice\program\soffice.exe
```

## FFmpeg / FFprobe

FFmpeg와 FFprobe는 앱에 동봉된 정적 바이너리를 사용합니다. 시스템에 설치된 FFmpeg에 의존하지 않습니다.

배포 시 다음 파일을 함께 포함해야 합니다.

```text
THIRD_PARTY_NOTICES.md
legal/FFMPEG_SOURCE_OFFER.txt
legal/licenses/ffmpeg-static/
legal/licenses/ffprobe-static/
```

## PDFium / Chromium / Electron

Convert Smith는 Electron 기반 앱입니다. Electron은 Chromium 구성요소를 포함하며, PDF 미리보기와 일부 렌더링 경로는 Chromium/PDFium 계열 기능을 사용할 수 있습니다.

배포 시 다음 파일을 함께 포함해야 합니다.

```text
legal/PDFIUM_CHROMIUM_NOTICE.txt
legal/licenses/electron/LICENSE
legal/licenses/electron/LICENSES.chromium.html
```

## 제3자 라이선스 고지

배포 패키지에는 다음 고지 파일이 포함되어야 합니다.

```text
THIRD_PARTY_NOTICES.md
legal/EULA.txt
legal/INSTALLER_EULA.txt
legal/FFMPEG_SOURCE_OFFER.txt
legal/PDFIUM_CHROMIUM_NOTICE.txt
legal/licenses/
```

Convert Smith 자체 저작권 및 배포 제한은 JINKYU YOO에게 적용됩니다. 단, FFmpeg, FFprobe, Electron, Chromium, PDFium, React, sharp, pdf-lib, pdfjs-dist 등 오픈소스 구성요소에 대해 각 라이선스가 사용자에게 부여하는 권리는 제한하지 않습니다.

## PDF 편집기 구현 로드맵

PDF 편집기는 일반 PDF 도구와 분리된 별도 모드입니다. Acrobat Pro 수준의 원본 유지 편집에 가까워지려면 단계별 구현이 필요합니다.

현재 로드맵은 다음 문서에 정리되어 있습니다.

```text
docs/PDF_EDITOR_10_STEP_ROADMAP.md
docs/USER_VALIDATION_CHECKLIST.md
```

## 알려진 제한

- PDF -> DOCX 변환은 원본 레이아웃이 완벽히 유지되지 않을 수 있습니다.
- JPG -> PNG 변환은 배경을 자동으로 투명하게 만들지 않습니다.
- 일부 손상 파일, DRM 보호 파일, 암호화 파일은 변환하거나 복구할 수 없습니다.
- HEIC 입력 변환은 지원하지만 JPG/PNG -> HEIC 출력은 지원하지 않습니다.
- PDF 편집기 실험 모드는 텍스트, 이미지, 선, 표를 단계적으로 인식하고 편집하도록 개선 중입니다.
