# Setting Searchbar

RisuAI의 sidecar 프로젝트.
RisuAI 소스코드를 수정하지 않고, HTTP 프록시 레이어와 클라이언트 스크립트 인젝션으로 설정 페이지에 검색 기능을 추가한다.

## 런타임 환경

- **RisuAI를 Docker(Node 서버)로 구동하는 환경을 전제로 한다.**
- 클라이언트 스크립트는 `<script>` 인젝션으로 메인 앱과 동일한 컨텍스트에서 실행된다 (플러그인 샌드박스 아님).
- 설정 페이지의 DOM을 직접 읽어 검색 인덱스를 구축한다.

## 설계 우선순위

1. **P1 — 투명성**: risuai와의 통신이 반드시 성공해야 한다. 이 서버에 장애가 생겨도 클라이언트 요청은 upstream까지 도달해야 한다. risuai의 기존 HTTP API 인터페이스를 변경하거나 훼손하지 않는다.
2. **P2 — 비침투적**: RisuAI 본체 코드 수정 없이 동작한다. Svelte가 관리하는 기존 DOM 요소를 수정(클래스 토글, 자식 삽입, display 변경 등)하지 않는다. 검색 UI는 자체 컨테이너 안에서만 렌더링한다.
3. **P3 — 체이닝 호환**: remote-inlay, with-sqlite, sync 서버 등과 함께 프록시 체인으로 구성할 수 있다. Caddy 포트 :8081 → searchbar → :8082 → with-sqlite 위치.

## 핵심 제약

- **RisuAI 본체는 수정할 수 없다.** 제3자가 관리하는 별도 프로젝트이므로, 검색 관련 기능/문제는 반드시 이 프로젝트(risu-files/custom-codes/setting-searchbar/) 내에서 해결해야 한다.
- **Svelte DOM 간섭 금지**: `sidebar.prepend(ui)` 한 번의 삽입만 허용. 기존 요소에 대한 클래스 추가/제거, 자식 삽입, 스타일 변경, `insertAdjacentElement` 등은 Svelte 렌더링을 깨뜨릴 수 있으므로 금지한다.
- **MutationObserver(body, subtree) 금지**: Svelte와 충돌한다. 설정 페이지 감지는 setInterval 폴링을 사용한다.

## 아키텍처

```
서버 (src/server/)
  HTTP 프록시. GET / 응답에 <script> 태그 주입, /setting-searchbar/client.js 서빙.

클라이언트 (src/client/)
  index.ts    — 설정 페이지 감지(폴링), 검색 UI 주입
  ui.ts       — 검색바 DOM, 검색 로직, 결과 렌더링
  indexer.ts  — 설정 탭 순회 + DOM 텍스트 수집 → IndexEntry[] 반환
  navigator.ts — 탭/서브탭 이동 + 하이라이트
  types.ts    — IndexEntry 타입
```

핵심 인터페이스: `buildIndex(onProgress?) → Promise<IndexEntry[]>`. 인덱서 내부 구현이 바뀌어도 UI 코드는 수정 불필요.

## 기각된 방향

- **RisuAI 플러그인 API**: iframe 샌드박스 안에서 실행되어 SettingsMenuIndex 등 Svelte store 접근 불가.
- **iframe 기반 인덱싱**: blob URL로 readonly 앱 인스턴스를 띄우려 했으나, (1) IDB readonly 강제 시 앱 초기화 실패, (2) RisuAI의 탭 비활성화 감지가 iframe을 차단. 서버 사이드 Puppeteer도 동일 카테고리(앱을 한 벌 더 띄우는 방식)로 기각.
- **사이드바 버튼 hide/inject(IntelliJ 스타일 필터링)**: Svelte 관리 DOM에 `.ssb-hidden` 클래스 추가 + `insertAdjacentElement`로 sub-item 삽입 → Svelte 렌더링 깨짐. 결과 리스트는 자체 컨테이너에서만 렌더링해야 한다.

## Docker 실행

Docker 구성은 `risu-files/custom-codes/risuai-network/` 레포에서 관리한다.
이 프로젝트 단독으로 `docker build/run`하지 않고, network 레포의 `docker-compose.yml`로 실행한다.

```bash
docker compose -f risu-files/custom-codes/risuai-network/docker-compose.yml \
  --profile searchbar up -d
```

## Git

- 커밋 시 `/commit-with-context`를 사용하여 의사결정 컨텍스트를 보존한다.
- 후속 작업 시 `git log`를 확인하여 기존 결정 배경과 기각된 방향을 참조한다.

## 문서

- API 엔드포인트, 환경변수, 프로젝트 구조 등 외부 인터페이스가 변경되면 README.md도 함께 업데이트한다.

## 코딩 컨벤션

- TypeScript에서 `as` 타입단언을 사용하지 않는다. interface의 index signature, 제네릭, 타입 가드 등으로 해결한다.
