# 🤖 Conana Bot (Docker / n8n / OpenCode)

이 프로젝트는 n8n 워크플로우를 통해 **Telegram 봇**과 로컬 **OpenCode(Antigravity) CLI**를 연동하는 최첨단 자동화 시스템입니다. 모든 환경이 Docker 컨테이너로 추상화되어 있어, 복잡한 설정 없이 명령 한 줄로 즉시 나만의 코딩 어시스턴트 봇을 구축할 수 있습니다.

---

## ✨ 핵심 기능 (Key Features)

-   **완전 자동화 (Stateless Architecture)**: 시스템 시작 시 워크플로우 임포트, 활성화, 텔레그램 웹훅 등록이 자동으로 수행됩니다.
-   **로그인 프리 (No-Login Access)**: n8n 사용자 관리 시스템을 비활성화하여, 별도의 계정 생성이나 로그인 없이 바로 워크플로우를 관리할 수 있습니다.
-   **동적 보안 주입**: `.env`의 민감한 토큰 정보가 실행 시점에 워크플로우에 안전하게 주입되어 권한 충돌 문제를 원천 차단합니다.
-   **무중단 웹훅**: `Cloudflare Tunnel`을 통해 동적 IP 환경에서도 안정적인 외부 웹훅 URL을 자동으로 할당받습니다.
-   **OpenCode CLI 공유**: Host PC의 인증 세션을 컨테이너와 실시간으로 공유하여 별도의 재인증이 필요 없습니다.
-   **세션 관리 강화**: 사용자의 대화 기록(Session)이 유지되며, 각 분석 리포트마다 할당된 세션 ID가 표시됩니다.
-   **스마트 블로그 작성**: `/naverblog` 명령어를 통해 특정 주제에 대한 고품질 네이버 블로그 포스팅 초안을 즉시 생성합니다.
-   **주식 포트폴리오 분석**: `/stock` 명령어와 함께 포트폴리오 스크린샷 1장 또는 여러 장(앨범)을 보내면 Gemini Vision으로 종목 정보를 추출하고 오늘의 투자 전략 리포트를 자동 생성합니다.
-   **스마트 모델 폴백(Fallback)**: 할당량(Quota) 초과 시 자동으로 `FALLBACK_MODEL`로 전환하여 봇 응답이 중단되지 않도록 보장합니다.

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
| `/new` | 현재 대화 세션을 초기화하고 새로운 세션 시작 | `/new` |
| `/naverblog [주제]` | 특정 주제에 최적화된 블로그 포스팅 초안 생성 | `/naverblog 인공지능 트렌드` |
| `/stock` + 📸 사진 | 포트폴리오 통계, 종목 추출 및 투자 전략 리포트 생성 (여러 장 전송 가능) | 사진 여러 장과 함께 `/stock` |
| `/mail` | AI를 통한 이메일 초안 작성 및 발송 (Gmail SMTP) | `/mail user@example.com "이메일 제목과 본문 내용 요약"` |

---

## 🛠️ 설치 및 설정 (Setup)

1.  **환경 변수 설정**: 프로젝트 루트에 `.env` 파일을 생성하고 정보를 입력합니다.
    ```env
    TELEGRAM_TOKEN=your_bot_token_here
    PRIMARY_MODEL=google/antigravity-gemini-3-flash
    FALLBACK_MODEL=google/antigravity-gemini-3.1-pro
    STOCK_MODEL=google/antigravity-claude-opus-4-6-thinking
    OPENCODE_TIMEOUT_MS=600000
    GMAIL_USER=your_email@gmail.com
    GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
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

## 🏗️ 시스템 아키텍처 (Microservices)

이 프로젝트는 유지보수성과 확장성을 위해 **마이크로서비스 아키텍처**로 설계되었습니다. n8n은 워크플로우 제어에 집중하고, 복잡한 비즈니스 로직은 각 전용 프록시 서비스가 처리합니다:

-   **router-service**: 사용자의 메시지를 분석하고 정교한 LLM 분류를 통해 가장 적절한 서비스(일반, 블로그, 주식, 메일 등)로 라우팅합니다.
-   **general-proxy** (구 opencode-proxy): 로컬 OpenCode CLI를 실행하는 핵심 서버입니다. 일반적인 Q&A, 코딩 질문, 이미지 분석을 담당하며, 개발 관련이 아닌 일반적인 대화는 더 빠르고 자연스러운 모델(Gemini Flash)로 유연하게 전환하여 답변합니다.
-   **naver-proxy**: 네이버 블로그 콘텐츠 생성 전용 서비스입니다. 고품질 글 작성을 위한 프롬프트 엔지니어링 및 텍스트 포맷팅 로직이 내장되어 있습니다.
-   **stock-proxy**: 주식 포트폴리오 분석 시스템입니다. 텔레그램 이미지 다운로드, 텍스트 데이터 추출, 시각적 데이터 분석, 투자 전략 수립 및 리포트 생성을 통합 처리합니다.
-   **email-proxy**: AI를 활용한 이메일 초안 작성 및 자동 발송 서비스입니다. 송신처 누락 시 사용자에게 정보를 되물어보는 대화형 플로우를 지원합니다.
-   **n8n / Cloudflare Tunnel**: 워크플로우를 자동화하고 텔레그램 웹훅을 수신 및 연동합니다.

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
