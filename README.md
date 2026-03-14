# 🤖 Conana Bot (Docker / n8n / OpenCode)

이 프로젝트는 n8n 워크플로우를 통해 **Telegram 봇**과 로컬 **OpenCode(Antigravity) CLI**를 연동하는 최첨단 자동화 시스템입니다. 모든 환경이 Docker 컨테이너로 추상화되어 있어, 복잡한 설정 없이 명령 한 줄로 즉시 나만의 코딩 어시스턴트 봇을 구축할 수 있습니다.

---

## ✨ 핵심 기능 (Key Features)

-   **완전 자동화 (Stateless Architecture)**: 시스템 시작 시 워크플로우 임포트, 활성화, 텔레그램 웹훅 등록이 자동으로 수행됩니다.
-   **로그인 프리 (No-Login Access)**: n8n 사용자 관리 시스템을 비활성화하여, 별도의 계정 생성이나 로그인 없이 바로 워크플로우를 관리할 수 있습니다.
-   **동적 보안 주입**: `.env`의 민감한 토큰 정보가 실행 시점에 워크플로우에 안전하게 주입되어 권한 충돌 문제를 원천 차단합니다.
-   **무중단 웹훅**: `Cloudflare Tunnel`을 통해 동적 IP 환경에서도 안정적인 외부 웹훅 URL을 자동으로 할당받습니다.
-   **OpenCode CLI 공유**: Host PC의 인증 세션을 컨테이너와 실시간으로 공유하여 별도의 재인증이 필요 없습니다.
-   **스마트 블로그 작성**: `/naverblog` 명령어를 통해 특정 주제에 대한 고품질 네이버 블로그 포스팅 초안을 즉시 생성합니다.

---

## 🚀 사전 준비 (Prerequisites)

1.  **Docker & Docker Compose**: 시스템에 Docker 데스크탑이 실행 중이어야 합니다.
2.  **OpenCode 인증**: Host 터미널에서 `opencode auth login`을 통해 최소 1회 인증을 마친 상태여야 합니다.
3.  **Telegram Bot**: `@BotFather`를 통해 생성한 **Bot Token**이 필요합니다.

---

## 🎮 명령어 가이드 (Commands)

텔레그램 채팅창에서 다음 명령어를 사용해보세요:

| 명령어 | 설명 | 예시 |
| :--- | :--- | :--- |
| `(일반 메시지)` | OpenCode/Gemini와 자유롭게 대화 및 코딩 상담 | `파이썬으로 웹 크롤러 짜줘` |
| `/naverblog [주제]` | 특정 주제에 최적화된 블로그 포스팅 초안 생성 | `/naverblog 인공지능 트렌드` |

---

## 🛠️ 설치 및 설정 (Setup)

1.  **환경 변수 설정**: 프로젝트 루트에 `.env` 파일을 생성하고 정보를 입력합니다.
    ```env
    TELEGRAM_TOKEN=your_bot_token_here
    PRIMARY_MODEL=google/antigravity-gemini-3-flash
    FALLBACK_MODEL=google/antigravity-gemini-3.1-pro
    OPENCODE_TIMEOUT_MS=300000
    ```

2.  **시스템 실행**:
    ```bash
    chmod +x *.sh
    ./docker-start.sh
    ```

---

## ⚙️ 사용 가이드

### 1. 시스템 관리
-   **시작**: `./docker-start.sh`  
    *(터널 생성 -> 컨테이너 빌드 -> 워크플로우 임포트 -> 활성화 -> 웹훅 동기화가 순차적으로 진행됩니다)*
-   **종료**: `./docker-stop.sh`  
    *(터널 및 모든 컨테이너를 안전하게 종료합니다)*
-   **완전 초기화**: `docker compose down -v` 후 `./docker-start.sh`  
    *(n8n 내부 데이터를 모두 삭제하고 깨끗한 상태에서 다시 시작합니다)*

### 2. n8n UI 접속
-   **주소**: [http://localhost:5678](http://localhost:5678)
-   **특징**: 로그인 화면 없이 바로 접속되어 워크플로우 실행 이력(Executions)을 모니터링할 수 있습니다.

---

## 🏗️ 시스템 아키텍처

-   **n8n-opencode**: 워크플로우 엔진. 텔레그램 메시지를 수신하고 전체 로직을 제어합니다.
-   **opencode-proxy**: n8n의 요청을 받아 로컬 OpenCode CLI를 실행해주는 다리 역할을 합니다.
-   **Cloudflare Tunnel**: 로컬 n8n을 안전하게 외부에 노출시켜 텔레그램 웹훅을 수신 가능하게 합니다.
-   **Gemini/OpenCode AI**: 고성능 LLM을 통해 단순 대화부터 논리적인 블로그 글 작성까지 처리합니다.

---

## 🚑 이슈 해결 (Troubleshooting)

### 텔레그램 응답이 없을 때
1.  `./docker-start.sh` 실행 로그에서 `✅ Workflow activated` 메시지가 떴는지 확인하세요.
2.  n8n UI의 **Executions** 탭에서 로그가 찍히는지 확인하세요.
3.  로그에 `400 Bad Request`가 보인다면, 텔레그램에 등록된 웹훅 주소와 현재 터널 주소가 일치하는지 확인하세요 (스크립트가 자동으로 이 작업을 수행합니다).

### OpenCode 실행 오류
-   Host PC 터미널에서 `opencode run "test"`가 정상 동작하는지 먼저 확인하세요.
-   인증 만료 시 Host PC에서 다시 로그인하면 컨테이너에 즉시 반영됩니다.

---

**Happy Coding with Conana Bot!** 🤖✨
