# Convert Smith

Convert Smith는 파일을 로컬 PC 안에서 실제로 열리는 형식으로 변환하는 Electron 데스크톱 앱입니다.

> 확장자만 바꾸지 않고, 실제로 열리는 파일로 변환합니다.

파일은 클라우드로 업로드하지 않습니다. 로그인, 계정, 데이터베이스 없이 사용자의 PC 안에서 변환을 실행합니다.

## 왜 확장자 변경이 아닌가

파일 확장자는 이름표일 뿐입니다. 예를 들어 `.mp4`라고 표시된 동영상도 내부 비디오 코덱이 HEVC이거나 오디오 코덱이 플레이어와 맞지 않으면 재생되지 않을 수 있습니다.

Convert Smith는 단순히 파일명을 바꾸지 않습니다. FFmpeg, Sharp, PDF/Office 변환 엔진을 사용해 내부 컨테이너, 코덱, 문서 구조를 새로 만들고 검증된 출력 파일을 생성합니다.

## 주요 기능

- PDF → Word / DOCX
- Word / DOCX → PDF
- JPG / PNG → PDF
- PDF → JPG / PNG
- HEIC → JPG
- PNG → JPG
- JPG → PNG
- MP4 → MP3
- MOV → MP4
- Excel / XLSX → PDF
- 동영상 호환성 복구 MP4

동영상 호환성 복구는 MP4/MOV/MKV/WEBM/M4V 입력을 H.264 + AAC, yuv420p, faststart MP4로 다시 인코딩합니다.

## 설치

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

스모크 테스트는 샘플 PNG/MP4/PDF를 생성해 대표 변환과 출력 파일 검증을 확인합니다.

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

## LibreOffice 요구사항

DOCX/XLSX → PDF 변환에는 LibreOffice가 필요합니다.

설치 방법:

1. 공식 다운로드 페이지에서 Windows x86-64용 LibreOffice를 설치합니다.
2. Convert Smith를 실행합니다.
3. 우측 상단 톱니바퀴 버튼을 엽니다.
4. `설정 → LibreOffice 경로 지정`을 누릅니다.
5. 보통 아래 경로의 `soffice.exe`를 선택합니다.

일반적인 Windows 경로:

```text
C:\Program Files\LibreOffice\program\soffice.exe
C:\Program Files (x86)\LibreOffice\program\soffice.exe
```

앱은 위 경로를 자동 감지합니다. 자동 감지에 실패하면 설정에서 직접 지정하면 됩니다.

## 보안 구조

- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer는 Node API에 직접 접근하지 않음
- Preload에서 `contextBridge`로 제한된 API만 노출
- 변환 경로 검증과 프로세스 실행은 Electron main process에서 수행
- FFmpeg/LibreOffice 실행은 `child_process.spawn` 배열 인자만 사용
- Renderer 입력으로 임의 shell 명령을 실행하지 않음

## 출력 검증

변환 후 출력 파일이 존재하고 크기가 0보다 큰지 확인합니다.

추가 검증:

- PDF: `%PDF-` 헤더 검사
- JPG: JPEG magic byte 검사
- PNG: PNG magic byte 검사
- DOCX/XLSX: ZIP 기반 Office 문서 검사
- MP4/MP3: FFprobe 읽기 검사
- 호환 MP4: H.264, yuv420p, AAC 조건 검사

검증에 실패하면 성공으로 표시하지 않고 한국어 오류 메시지를 보여줍니다.

## 알려진 제한사항

- PDF → DOCX는 원본 레이아웃을 100% 보존하지 못할 수 있습니다.
- PDF → DOCX 편집형은 텍스트 편집을 우선하는 best effort 변환입니다.
- PDF → DOCX 외형 보존형은 페이지 이미지를 DOCX에 넣으므로 텍스트 편집이 어렵습니다.
- JPG → PNG는 배경을 자동으로 투명하게 만들지 않습니다.
- 심하게 손상된 파일은 복구하지 못할 수 있습니다.
- DRM으로 보호된 파일은 지원하지 않습니다.
- DOCX/XLSX → PDF 품질은 설치된 LibreOffice 렌더링 결과의 영향을 받습니다.
