# Convert Smith

Convert Smith는 로컬 PC에서 실제로 열리는 파일 형식으로 변환하는 Electron 데스크톱 앱입니다.

> 확장자만 바꾸지 않고, 실제로 열리는 파일로 변환합니다.

파일은 클라우드로 업로드하지 않습니다. 로그인, 계정, 데이터베이스 없이 사용자의 PC 안에서 변환을 실행합니다.

## 왜 단순 확장자 변경이 아닌가

파일 확장자는 이름표일 뿐입니다. 예를 들어 `.mp4`라고 표시된 동영상도 내부 비디오 코덱이 HEVC이거나 오디오 코덱이 플레이어와 맞지 않으면 재생되지 않을 수 있습니다.

Convert Smith는 파일명을 바꾸는 대신 FFmpeg, Sharp, PDF/Office 엔진을 사용해 내부 컨테이너, 코덱, 이미지 포맷, 문서 구조를 새로 만들고 검증된 출력 파일을 생성합니다.

## 주요 기능

파일 변환:

- PDF → Word / DOCX
- Word / DOCX → PDF
- 이미지 → PDF
- PDF → JPG / PNG
- HEIC → JPG
- HEIC → PNG
- PNG → JPG
- JPG → PNG
- JPG / PNG → WEBP
- WEBP → JPG / PNG
- AVIF → JPG / PNG
- TIFF → JPG / PNG
- BMP → JPG / PNG
- MP4 → MP3
- MOV / WEBM / MKV → MP4
- WAV / FLAC / M4A → MP3
- Excel / XLSX → PDF
- Excel / XLSX → CSV
- PowerPoint / PPTX → PDF
- 동영상 호환성 복구 MP4

PDF 도구:

- PDF 병합
- PDF 페이지 정렬
- PDF 전체 페이지 분할
- PDF 선택 그룹 분할
- PDF 페이지 회전

동영상 호환성 복구는 MP4/MOV/MKV/WEBM/M4V 입력을 H.264 + AAC, yuv420p, faststart MP4로 다시 인코딩합니다.

## 설치

배포용 설치 파일을 받은 사용자는 `Convert Smith Setup x.x.x.exe`를 실행해 설치합니다. 현재 Windows 설치 파일은 설치 경로를 선택할 수 있는 설치 마법사 방식이며, 관리자 권한 설치로 동작합니다.

개발 환경에서 실행하려면 먼저 의존성을 설치합니다.

```bash
npm install
```

## 개발 실행

```bash
npm run dev
```

## 일반 실행

```bash
npm start
```

## 빌드

```bash
npm run build
npm run dist
```

Windows 설치 파일은 `release/` 폴더에 생성됩니다.

## 검증

```bash
npm run smoke
```

스모크 테스트는 샘플 PNG/MP4/WEBM/PDF를 생성해 이미지 변환, 미디어 변환, PDF 병합/분할, 출력 파일 검증을 확인합니다.

## 필수/번들 의존성

- Node.js
- Electron
- Vite
- React
- TypeScript
- Tailwind CSS
- ffmpeg-static
- ffprobe-static
- sharp
- heic-convert
- pdf-lib
- pdfjs-dist
- @napi-rs/canvas
- docx

FFmpeg와 FFprobe는 `ffmpeg-static`, `ffprobe-static`을 통해 번들됩니다. 시스템에 설치된 FFmpeg에 의존하지 않습니다.

## HEIC 변환

Convert Smith는 HEIC/HEIF 파일을 읽어 JPG 또는 PNG로 변환할 수 있습니다. JPG/PNG를 HEIC로 저장하는 기능은 HEVC 인코더와 라이선스 부담이 커 MVP 기능에서 제외했습니다.

앱 화면에서도 HEIC 입력은 지원하지만 HEIC 출력은 지원하지 않는다는 안내를 표시합니다.

## 배포 고지

배포용 설치 파일에는 다음 파일이 포함되도록 설정되어 있습니다.

- `THIRD_PARTY_NOTICES.md`
- `legal/EULA.txt`
- `legal/INSTALLER_EULA.txt`
- `legal/FFMPEG_SOURCE_OFFER.txt`
- `legal/licenses/ffmpeg-static/`
- `legal/licenses/ffprobe-static/`

Windows NSIS 설치 파일은 `legal/INSTALLER_EULA.txt`를 라이선스 화면으로 사용합니다. 앱 내부 약관과 배포 고지는 `legal/EULA.txt`, `THIRD_PARTY_NOTICES.md`, `legal/FFMPEG_SOURCE_OFFER.txt`를 함께 포함합니다. 배포 전에는 `legal/DISTRIBUTION_CHECKLIST.md`를 확인하세요.

## LibreOffice 요구사항

DOCX/XLSX/PPTX → PDF, XLSX → CSV 변환에는 LibreOffice가 필요합니다. Convert Smith는 LibreOffice를 기본 동봉하지 않으며, 사용자가 설치한 `soffice.exe` 또는 `soffice.com`을 호출합니다.

설치 방법:

1. LibreOffice 공식 다운로드 페이지에서 Windows x86-64 버전을 설치합니다.
2. Convert Smith를 실행합니다.
3. 우측 상단 톱니바퀴 버튼을 엽니다.
4. `설정 → LibreOffice 경로 지정`을 누릅니다.
5. 보통 아래 경로의 `soffice.exe` 또는 `soffice.com`을 선택합니다.

일반적인 Windows 경로:

```text
C:\Program Files\LibreOffice\program\soffice.exe
C:\Program Files\LibreOffice\program\soffice.com
C:\Program Files (x86)\LibreOffice\program\soffice.exe
C:\Program Files (x86)\LibreOffice\program\soffice.com
```

Convert Smith는 일반 경로를 자동 감지합니다. 자동 감지가 실패하면 설정에서 직접 지정하면 됩니다.

LibreOffice가 필요한 변환을 시작하면 앱이 시작 직전에 LibreOffice 상태를 다시 확인합니다. LibreOffice를 찾지 못하면 변환을 시작하지 않고 경로 지정 안내를 보여줍니다.

## 보안 구조

- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer는 Node API에 직접 접근하지 않음
- Preload에서 `contextBridge`로 제한된 API만 노출
- 변환 경로 검증과 프로세스 실행은 Electron main process에서 수행
- FFmpeg/LibreOffice 실행은 `child_process.spawn` 배열 인자만 사용
- Renderer 입력으로 임의 shell 명령을 실행하지 않음

## 출력 검증

변환 또는 PDF 작업 후 출력 파일이 존재하고 크기가 0보다 큰지 확인합니다.

추가 검증:

- PDF: `%PDF-` 헤더 검사
- JPG: JPEG magic byte 검사
- PNG: PNG magic byte 검사
- WEBP: RIFF/WEBP signature 검사
- DOCX/XLSX: ZIP 기반 Office 문서 검사
- MP4/MP3: FFprobe 읽기 검사
- 호환 MP4: H.264, yuv420p, AAC 조건 검사

검증에 실패하면 성공으로 표시하지 않고 한국어 오류 메시지를 보여줍니다.

## 출력 충돌과 복구 정책

- 원본 파일은 직접 수정하지 않습니다.
- 결과 파일은 항상 새 파일로 생성합니다.
- 같은 이름의 결과 파일이 이미 있으면 `_001`, `_002`처럼 번호를 붙여 저장합니다.
- 변환 실패, 취소, 검증 실패로 남은 불완전한 출력 파일은 자동 정리합니다.
- 변환 도중 앱이 종료되어도 원본 파일을 덮어쓰지 않는 구조를 유지합니다.

## 변환 전 안내

앱은 변환 시작 전에 다음 내용을 표시합니다.

- 대용량 영상 변환 예상 소요 시간
- LibreOffice가 필요한 변환의 사전 상태
- HEIC 입력 지원 및 HEIC 출력 제외 안내
- 원본 보호, 출력 충돌 처리, 실패 산출물 정리 정책

## 알려진 제한사항

- PDF → DOCX는 원본 레이아웃이 100% 유지되지 않을 수 있습니다.
- PDF → DOCX 편집형은 텍스트 편집을 우선하는 best effort 변환입니다.
- PDF → DOCX 외형 보존형은 PDF에서 선택 가능한 텍스트를 Word 텍스트로, PDF 내부 이미지 객체를 Word 이미지로 분리해 배치합니다. 벡터 도형이나 복잡한 표 구조가 Word 객체로 100% 재구성되지는 않을 수 있습니다.
- JPG → PNG는 배경을 자동으로 투명하게 만들지 않습니다.
- JPG/PNG → HEIC 저장은 지원하지 않습니다.
- XLSX → CSV는 서식, 색상, 병합 셀을 유지하지 않습니다.
- 일부 손상 파일은 복구하지 못할 수 있습니다.
- DRM 보호 파일은 지원하지 않습니다.
- Office → PDF 품질은 설치된 LibreOffice 렌더링 결과의 영향을 받습니다.
- 대용량 영상 예상 시간은 파일 크기 기준의 참고값이며 실제 시간은 PC 성능과 원본 코덱에 따라 달라질 수 있습니다.
