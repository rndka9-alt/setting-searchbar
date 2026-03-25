# RisuAI Setting Searchbar

RisuAI 설정 페이지에 검색 기능을 추가하는 리버스 프록시.
RisuAI 소스코드를 수정하지 않고, `<script>` 인젝션으로 설정 탭을 인덱싱하여 검색 UI를 제공한다.

## 실행 방법

### Docker (권장)

`risuai-network` 레포의 `docker-compose.yml`로 실행한다.

```bash
docker compose -f risu-files/custom-codes/risuai-network/docker-compose.yml \
  --profile searchbar up -d
```

### 단독 실행

```bash
npm install
npm run build
npm start
```

## 환경 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3004` | 리스닝 포트 |
| `UPSTREAM` | `http://localhost:6001` | upstream 서버 주소 |
| `LOG_LEVEL` | `info` | 로그 레벨 (`debug` \| `info`) |

## 동작 원리

```
브라우저 → setting-searchbar (:3004) → upstream
                │
                ├── GET / → upstream HTML에 <script> 인젝션
                ├── 클라이언트 JS가 설정 페이지 DOM 폴링
                └── 설정 탭 텍스트 인덱싱 → 검색 UI 렌더링
```

설정 페이지 진입 시 클라이언트가 모든 탭을 순회하며 텍스트를 수집하여 검색 인덱스를 구축한다.
검색 결과 선택 시 해당 탭으로 이동하고 항목을 하이라이트한다.

## API 엔드포인트

| 경로 | 설명 |
|------|------|
| `GET /setting-searchbar/client.js` | 클라이언트 JS |
| `GET /setting-searchbar/health` | 헬스 체크 |

그 외 모든 요청은 upstream으로 투명 프록시된다.

## 프로젝트 구조

```
├── build.js                # esbuild 빌드 스크립트
├── tsconfig.json           # TypeScript 설정
├── src/
│   ├── server/
│   │   ├── index.ts        # HTTP 서버 + 프록시
│   │   ├── config.ts       # 환경변수 로딩
│   │   └── inject-script-tag.ts  # HTML <script> 주입
│   └── client/
│       ├── index.ts        # 설정 페이지 감지 (폴링), UI 주입
│       ├── ui.ts           # 검색바 DOM, 검색 로직, 결과 렌더링
│       ├── indexer.ts      # 설정 탭 순회 + DOM 텍스트 수집
│       ├── navigator.ts    # 탭/서브탭 이동 + 하이라이트
│       └── types.ts        # IndexEntry 타입
├── Dockerfile
└── package.json
```
