# Conana Bot (Dockerized)

이 프로젝트는 n8n 워크플로우를 통해 Telegram 봇과 로컬 OpenCode(Antigravity)를 연동하는 자동화 시스템입니다.
모든 구성 요소(n8n, OpenCode Proxy)가 Docker 컨테이너 기반으로 동작하므로, 의존성 충돌 없이 깔끔하게 실행됩니다.

## 🚀 사전 설치 (Prerequisites)
이 시스템을 구동하기 위해 다음 프로그램들이 미리 준비되어야 합니다.

1. **Docker & Docker Compose**
   - 시스템에 Docker가 설치 및 실행 중이어야 합니다.
2. **OpenCode (Antigravity) 정상 로그인 상태**
   - 로컬 Host PC의 터미널에서 `opencode`가 실행 가능해야 하며, `opencode auth login` 등을 통해 최소 1회 이상 정상적으로 계정 연동 및 인증 캐시(OAuth)가 생성되어 있어야 합니다.
3. **Telegram Bot Token**
   - Telegram의 `@BotFather`를 통해 새 봇을 생성하고 API 토큰을 발급받아야 합니다.
4. **환경 변수 파일 (`.env`) 설정**
   - 루트 폴더에 `.env` 파일을 만들고 다음과 같이 입력합니다.
     ```env
     TELEGRAM_TOKEN=123456789:ABCDefghIJKL_mnopqr
     PRIMARY_MODEL=google/antigravity-gemini-3-flash
     FALLBACK_MODEL=google/antigravity-gemini-3.1-pro
     OPENCODE_TIMEOUT_MS=300000
     ```

## ⚙️ 시스템 시작 및 종료

이 프로젝트는 구동 및 종료의 편의를 돕는 쉘 스크립트를 제공합니다.

### 시스템 시작 (Start)
```bash
./docker-start.sh
```
- 기존에 실행 중이던 로컬 프로세스나 터널을 안전하게 정리합니다.
- `Cloudflare Tunnel`을 실행하여 n8n 웹훅용 외부 URL을 자동으로 할당받습니다.
- Docker Compose를 통해 `n8n`과 `opencode-proxy` 컨테이너를 올립니다.

### 시스템 종료 (Stop)
```bash
./docker-stop.sh
```
- 백그라운드 환경에서 실행 중이던 Docker 컨테이너들과 Cloudflare Tunnel을 모두 종료합니다.

## 🔄 OpenCode 계정 정보 (Antigravity) 반영 방법

이 시스템은 로컬 Host PC의 아래 디렉토리들을 `opencode-proxy` 컨테이너 내부로 직접 마운트(Volume Mount)하여 공유합니다.
- `~/.config/opencode`
- `~/.cache/opencode`
- `~/.local/share/opencode`

**따라서 계정 정보가 변경된 경우:**
1. 로컬 Mac(Host PC)의 일반 터미널에서 기존대로 `opencode` 명령어를 실행하여 계정을 갱신하거나 재로그인합니다.
2. 로컬에 갱신된 파일(`auth.json`, `antigravity-accounts.json` 등)은 **즉시 컨테이너 내부로 반영**됩니다.
3. 만약 컨테이너에서 즉시 갱신이 안 된다면 `docker compose restart opencode-proxy`를 실행해 프록시만 가볍게 재기동하시면 됩니다.

## 🚑 트러블슈팅 및 이슈 해결

### 1. 텔레그램에서 말을 걸어도 아무런 응답이 없는 경우
**원인**: Cloudflare Tunnel 주소가 변경되었거나, 연결이 끊어져서 텔레그램 Webhook이 로컬의 n8n으로 도달하지 못했을 수 있습니다.
**해결방법**:
1. `./docker-stop.sh` 후 `./docker-start.sh`를 실행하여 환경을 재시작합니다.
2. 스크립트 실행 로그 중 `Tunnel URL: https://...` 주소를 확인합니다.
3. [n8n 대시보드](http://localhost:5678)에 접속하여 텔레그램 워크플로우의 'Webhook' 노드 설정이 새 URL로 갱신되어 활성화(Active) 되었는지 확인합니다.

### 2. "Error: Google Generative AI API key is missing" 등 권한 오류가 발생할 때
**원인**: 컨테이너 내부의 OpenCode 플러그인이 로컬의 인증 정보(`auth.json`)를 찾지 못했거나, 토큰이 만료된 경우입니다.
**해결방법**:
1. Host PC의 터미널에서 `opencode run --model "google/antigravity-gemini-3-flash" "안녕"` 명령어를 직접 입력하여 정상적으로 응답이 오는지 테스트합니다.
2. 로컬에서는 동작하는데 봇에서만 안 된다면, 컨테이너를 재시작해 캐시를 갱신합니다.
   `docker compose restart opencode-proxy`
3. 프록시 내부의 상세 에러 로그를 확인하고 싶다면 아래 명령어를 입력합니다.
   `docker compose logs -f opencode-proxy`

### 3. n8n 워크플로우를 수정하고 저장하고 싶을 때
시스템이 실행 중일 때 `http://localhost:5678`에 들어가서 노드 로직을 자유롭게 편집할 수 있습니다. 
수정한 워크플로우는 n8n 화면에서 `Export` (다운로드)하여 루트 폴더의 `n8n-workflow-docker.json` 에 덮어써두면 안전하게 영구 보존됩니다.
