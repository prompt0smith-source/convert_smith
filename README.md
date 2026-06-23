# Convert Smith

Convert Smith는 확장자만 바꾸지 않고, 실제로 열리는 파일로 변환하는 로컬 우선 데스크톱 앱입니다.

모든 변환은 사용자의 PC에서 실행됩니다. 클라우드 업로드, 로그인, 결제, 온라인 변환 API를 사용하지 않습니다.

## 주요 기능

- PDF -> Word / DOCX
- Word / DOCX -> PDF
- JPG / PNG -> PDF
- PDF -> JPG / PNG
- HEIC -> JPG / PNG
- PNG <-> JPG, JPG/PNG/WEBP 최적화
- MP4 -> MP3
- MOV/WEBM -> MP4
- 동영상 호환성 복구 MP4
- Excel / XLSX -> PDF
- PDF 병합, 분할, 페이지 정렬, 페이지 회전
- PDF 서명 스탬프 추가
- PDF 편집기 실험 모드

## 확장자 변경이 아닌 이유

파일 확장자만 바꾸면 내부 구조, 컨테이너, 코덱, 문서 포맷은 바뀌지 않습니다.

Convert Smith는 변환 엔진을 통해 새 출력 파일을 만들고, 가능한 범위에서 파일 시그니처와 결과 파일 검증을 수행합니다. 예를 들어 동영상 호환성 복구는 MP4 확장자만 붙이는 것이 아니라 H.264, AAC, yuv420p, faststart 설정으로 다시 인코딩합니다.

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
npm run smoke:pdf-editor
```

## LibreOffice

DOCX, XLSX, PPTX 계열 문서를 PDF로 변환하려면 LibreOffice가 필요합니다. Convert Smith는 LibreOffice를 기본 동봉하지 않습니다.

설정에서 `soffice.exe` 경로를 지정할 수 있습니다.

Windows 기본 후보:

```text
C:\Program Files\LibreOffice\program\soffice.exe
C:\Program Files (x86)\LibreOffice\program\soffice.exe
```

## FFmpeg / FFprobe

FFmpeg와 FFprobe는 앱에 동봉된 정적 바이너리를 사용합니다. 시스템에 설치된 FFmpeg에 의존하지 않습니다.

배포 시 다음 파일이 포함되어야 합니다.

```text
THIRD_PARTY_NOTICES.md
legal/FFMPEG_SOURCE_OFFER.txt
legal/licenses/ffmpeg-static/
legal/licenses/ffprobe-static/
```

## PDFium / Chromium / Electron

Convert Smith는 Electron 기반 앱입니다. Electron은 Chromium 구성요소를 포함하며, PDF 미리보기와 일부 렌더링 경로에서 Chromium/PDFium 계열 기능을 사용할 수 있습니다.

배포 시 다음 파일이 포함되어야 합니다.

```text
legal/PDFIUM_CHROMIUM_NOTICE.txt
legal/licenses/electron/LICENSE
legal/licenses/electron/LICENSES.chromium.html
```

## 라이선스 고지

배포 패키지에는 다음 고지 파일이 포함되어야 합니다.

```text
THIRD_PARTY_NOTICES.md
legal/EULA.txt
legal/INSTALLER_EULA.txt
legal/FFMPEG_SOURCE_OFFER.txt
legal/PDFIUM_CHROMIUM_NOTICE.txt
legal/licenses/
```

Convert Smith 자체 저작권과 배포 제한은 JINKYU YOO에게 적용됩니다. 단, FFmpeg, FFprobe, Electron, Chromium, PDFium, React, sharp, pdf-lib, pdfjs-dist 등 오픈소스 구성요소에 대한 각 라이선스가 사용자에게 부여하는 권리는 제한하지 않습니다.

## PDF 편집기 현재 범위

Convert Smith의 PDF 편집기는 가능한 경우 PDF 내부 텍스트 명령을 직접 수정합니다. 지원되는 저장 방식은 다음과 같습니다.

- `direct_replace`: 원본 폰트로 표현 가능한 한 줄 텍스트를 직접 교체합니다.
- `delete_original`: 원본 텍스트 토큰을 비웁니다.
- `neutralize_and_insert`: 원본 텍스트 명령을 비우고 로컬 글꼴을 임베드한 실제 PDF 텍스트 객체를 삽입합니다.
- `add_text`: 새 텍스트 객체를 추가합니다.
- `unsupported`: 안전하게 저장할 수 없는 편집은 중단합니다.

흰 사각형으로 원본 텍스트를 가리는 방식은 사용하지 않습니다. 이미지/선/표 객체 편집 저장은 현재 직접 native patch가 없으면 제한됩니다.

저장 후에는 기본 PDF 검증, 흰 사각형 덮어쓰기 의심 명령 검사, 수정 영역 외 시각 diff 검증을 수행합니다.

이 기능은 Acrobat Pro 또는 ALPDF 수준의 범용 PDF 편집 호환성을 보장하지 않습니다. 스캔 PDF, 이미지 PDF, Type3 폰트, 복잡한 subset 폰트, 회전/왜곡 텍스트, 반복 텍스트가 모호한 PDF는 보기 전용 또는 저장 제한으로 처리될 수 있습니다.

상세 로드맵:

```text
docs/PDF_EDITOR_10_STEP_ROADMAP.md
docs/USER_VALIDATION_CHECKLIST.md
docs/PDF_EDITING_ENGINE_REVIEW.md
```

## 알려진 제한

- PDF -> DOCX 변환은 원본 레이아웃이 완벽히 유지되지 않을 수 있습니다.
- JPG -> PNG 변환은 배경을 자동으로 투명하게 만들지 않습니다.
- 일부 손상 파일, DRM 보호 파일, 암호화 파일은 변환하거나 복구할 수 없습니다.
- HEIC 입력 변환은 지원하지만 JPG/PNG -> HEIC 출력은 지원하지 않습니다.
- PDF 편집기는 안전한 native text edit 중심으로 개선 중이며, 직접 수정이 불가능한 PDF는 저장이 제한됩니다.
