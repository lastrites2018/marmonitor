<p align="center">
  <img src="docs/banner-ansi.png" alt="marmonitor" width="640">
</p>

<p align="center">
  <strong>Claude Code, Codex, Gemini를 위한 tmux 상태바 모니터 — AI 코딩 세션을 실시간으로 추적하세요</strong>
</p>

<p align="center">
  <a href="https://github.com/mjjo16/marmonitor/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/marmonitor" alt="license"></a>
  <img src="https://img.shields.io/node/v/marmonitor" alt="node version">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="platform">
</p>

<p align="center">
  <a href="README.md">English</a> | <b>한국어</b>
</p>

---

> **포크 안내**
>
> 이 저장소는 MJ JO가 만든 원본 `marmonitor`를 바탕으로 개인적으로 수정해 쓰는 포크입니다. tmux 기반 AI 세션 모니터링, attention 중심 상태줄, 외부 계측 없이 프로세스와 세션 파일을 읽어 상태를 복원하는 핵심 아이디어는 원저작자와 원본 프로젝트의 기여에서 출발했습니다. 이 포크는 그 위에 개인 워크플로에 맞춘 변경을 덧댄 버전일 뿐이며, 정식 기준 구현은 아닙니다.
>
> 아래 README는 이 포크의 현재 동작을 설명합니다. 여기 적힌 tmux 상호작용 중 일부는 upstream 플러그인 기본 동작을 그대로 설명하는 것이 아니라, 원본 프로젝트의 바이너리와 아이디어 위에 개인적으로 덧댄 로컬 tmux 설정까지 포함한 내용입니다.


## 왜 marmonitor인가?

tmux에서 여러 AI 코딩 에이전트를 동시에 실행하는 것은 이제 일상이 되었습니다 — Claude Code가 백엔드를 리팩토링하고, Codex가 다른 패널에서 테스트를 작성하고, Gemini가 문서를 검토합니다. 하지만 세션이 늘어날수록 같은 문제에 부딪힙니다:

- 패널로 전환했더니 에이전트가 10분째 `allow` 승인을 기다리고 있었다
- 방금 작업하던 Codex 세션이 어느 윈도우에 있는지 기억나지 않는다
- 여러 세션에서 토큰을 얼마나 소모했는지 알 수 없다

**이를 위한 대시보드가 없습니다.** 패널을 하나하나 돌아가며 직접 확인해야 합니다.

**marmonitor**가 이 문제를 해결합니다. 작은 tmux 연동만으로도 상태바가 머신에서 실행 중인 모든 AI 세션의 실시간 컨트롤 패널이 됩니다.

<p align="center">
  <img src="docs/use_sample.png" alt="marmonitor tmux 상태바" width="640">
  <br>
  <em>에이전트 수, 단계 뱃지, 번호가 매겨진 어텐션 필 — 모두 tmux 상태바에 표시됩니다</em>
</p>

### 주요 기능

**tmux 상태바** — 터미널 하단에 항상 표시:
- 에이전트 수 (`Cl 12`, `Cx 2`, `Gm 1`) — 실행 중인 세션 수
- 요약 뱃지 (`⏳ 1`, `⚠ 2`, `🤔 2`, `🔧 1`) — 클릭하면 해당 범주의 세션만 모은 popup chooser 열기. `⚠`는 `Sessions Needing Review` popup을 열고, 내부에서 `Inactive for a While`와 `Unresolved AI Processes`로 나눠 보여줍니다
- 번호가 붙은 어텐션 항목 (`1 ⏳Cl my-project allow`, `2 🤔Cx api-server 6m`) — 클릭하면 해당 tmux 패널로 바로 이동
- 오른쪽 idle rail (`idle Cl2 Cx3 | marmonitor · roam-new`) — 현재 켜져 있고 다시 투입 가능한 warm-idle Claude/Codex 세션 표시, idle 요약도 클릭 가능

**어텐션 우선순위** — 입력이 필요한 세션이 먼저 표시:
- ⏳ `permission` (승인 대기)이 항상 #1 — 승인이 필요합니다
- 🤔 / 🔧 최근 `thinking`, `tool` 세션이 그 뒤를 잇습니다
- 방금 끝난 세션은 최대 10분 동안만 왼쪽에 남고, warm-idle 세션은 오른쪽 rail로, cold-idle 세션은 popup/inventory 쪽으로 밀립니다

**빠른 이동** — 번호가 붙은 어텐션 항목을 클릭하거나 `Option+1`을 눌러 #1 어텐션 세션으로 바로 이동합니다. 윈도우를 뒤질 필요가 없습니다.

**낮은 지연의 상태줄 경로** — 이 포크는 얇은 statusline client(`marmonitor-statusline`)와 collector 기반 artifact를 사용해, 멀티세션 환경에서도 tmux foreground refresh 경로를 가볍게 유지합니다.

**전체 상태 확인** — `marmonitor status`로 모든 정보 확인:

<p align="center">
  <img src="docs/use_status_sample.png" alt="marmonitor status 출력" width="640">
  <br>
  <em>모든 세션의 상태, 토큰, 단계, CPU/MEM, 워커 프로세스 트리</em>
</p>

**계측 불필요** — API 키, 에이전트 플러그인, 코드 변경 없이 사용 가능합니다. marmonitor는 외부에서 로컬 프로세스 정보와 세션 파일을 읽습니다. 이 포크는 source-first 기준으로 설명하며, 여기 적힌 저지연 tmux 흐름은 이 포크 코드 위에 collector와 전용 statusline/click helper를 함께 사용하는 구성을 전제로 합니다. `npm install -g marmonitor`는 이 포크가 아니라 upstream baseline 패키지를 설치합니다.

> **tmux + AI 멀티세션 워크플로우를 위해 만들었습니다.** 매일 5개 이상의 AI 코딩 세션을 다양한 프로젝트에서 실행한다면, marmonitor는 컨텍스트 전환을 추측에서 상태바 한 번 확인으로 바꿔줍니다.

## 이 포크에서 달라진 점

이 포크는 원본 marmonitor의 방향을 유지하되, 개인 워크플로에 맞춰 몇 가지를 더 강하게 밀어 붙였습니다.

- collector 기반 statusline 서빙으로 tmux 갱신 지연 완화
- summary badge 클릭 시 필터된 popup chooser 열기
- 번호가 붙은 detail item 클릭 시 바로 점프
- 다시 투입 가능한 warm-idle Claude/Codex 세션을 보여주는 오른쪽 idle rail
- recent-complete와 warm-idle을 구분하는 statusline projection
- tmux-facing 경로를 분리한 helper 바이너리 (`marmonitor-statusline`, `marmonitor-status-click`)

즉, 원본 프로젝트의 정식 방향을 설명하는 문서라기보다, 한 사람이 실제로 쓰기 좋게 다듬은 개인 수정본의 동작을 설명하는 README로 보는 편이 맞습니다.

## 지원 에이전트

| 에이전트 | 탐지 방식 | 세션 정보 | 단계 추적 |
|---------|----------|----------|----------|
| **Claude Code** | 네이티브 바이너리 | 토큰, 타임스탬프, 모델 | thinking, tool, permission, done |
| **Codex** | 바이너리 + cmd 폴백 | 토큰, 타임스탬프, 모델 | thinking, tool, done |
| **Gemini** | cmd 폴백 | 토큰, 타임스탬프, 모델 | thinking, tool, done |

## 설치

### 1. marmonitor 설치

이 README에서 설명하는 현재 포크 동작을 그대로 재현하려면 소스에서 설치하는 편이 맞습니다.

```bash
git clone https://github.com/lastrites2018/marmonitor.git
cd marmonitor
npm install && npm run build
npm link
```

선택 사항: 현재 포크가 아니라 upstream baseline 패키지만 쓰고 싶다면 아래처럼 설치할 수 있습니다.

```bash
npm install -g marmonitor
```

### 2. tmux 연동 경로 선택

```bash
marmonitor setup tmux
```

upstream [marmonitor-tmux](https://github.com/mjjo16/marmonitor-tmux) 플러그인을 `~/.tmux.conf`에 추가하는 빠른 기본 경로입니다. tmux 안에서 `prefix + I`을 눌러 활성화하세요.

현재 tmux가 어떤 방식으로 연결돼 있는지 진단하려면 아래 명령을 실행하면 됩니다.

```bash
marmonitor update-integration
```

이 명령은 진단 전용입니다. tmux 설정을 자동으로 수정하거나 pull/reload를 대신 실행하지 않습니다.

다만 이 포크의 현재 저지연 워크플로는 플러그인만으로 완결된다고 보기보다, 아래 구성까지 함께 쓰는 개인 설정을 기준으로 설명하는 편이 정확합니다.

- collector 실행 (`marmonitor collector start`)
- tmux statusline 경로에서 `marmonitor-statusline` 사용
- tmux 마우스 클릭 경로에서 `marmonitor-status-click` 사용

즉 `setup tmux`는 baseline이고, 이 README는 그 위에 개인적으로 덧댄 tmux wiring까지 포함한 현재 포크 동작을 설명합니다.

<details>
<summary>직접 ~/.tmux.conf에 추가하기</summary>

```bash
set -g @plugin 'mjjo16/marmonitor-tmux'
```

[tpm](https://github.com/tmux-plugins/tpm)이 필요합니다.
</details>

<details>
<summary>수동 설치 (tpm 없이)</summary>

```bash
git clone https://github.com/mjjo16/marmonitor-tmux ~/.tmux/plugins/marmonitor-tmux
```

`~/.tmux.conf`에 추가:
```bash
run-shell ~/.tmux/plugins/marmonitor-tmux/marmonitor.tmux
```
</details>

<details>
<summary>소스에서 설치 (개발용)</summary>

```bash
git clone https://github.com/lastrites2018/marmonitor.git
cd marmonitor
npm install && npm run build
npm link
```
</details>

## 빠른 시작

이 포크를 설치하면 tmux 상태바에 AI 세션 뱃지를 표시할 수 있습니다. 이 포크의 현재 tmux 흐름에서는 추가로 다음 기능을 기대할 수 있습니다.

| 단축키 | 동작 |
|--------|------|
| `prefix + a` | 어텐션 팝업 — 검토할 세션 선택 |
| `prefix + j` | 점프 팝업 — 이동할 세션 선택 |
| `prefix + m` | 독 — 컴팩트 모니터 패널 |
| `Option+1~5` | 어텐션 세션 #1~5로 바로 이동 |
| 상태줄 `↩` | 현재 client 기준 이전 tmux 위치로 돌아가기 |

이 포크의 현재 tmux 흐름에서는 summary badge, 번호가 붙은 detail item, idle summary, jump-back 표시도 마우스로 클릭할 수 있습니다.

CLI 명령어:

```bash
marmonitor status       # 전체 세션 목록
marmonitor attention    # 입력이 필요한 세션 확인
marmonitor watch        # 실시간 전체 화면 모니터
marmonitor collector start   # 백그라운드 collector 시작
marmonitor collector status  # collector 상태 확인
marmonitor popup --summary-target phase:thinking   # 필터된 popup chooser 열기
marmonitor-statusline --statusline --statusline-format tmux-badges   # tmux 전용 얇은 statusline client
marmonitor-status-click sum:think                  # tmux 클릭 helper 진입점
marmonitor help         # 모든 명령어 및 옵션
```

## 단계 아이콘

| 아이콘 | 단계 | 의미 |
|--------|------|------|
| ⏳ | `permission` | AI가 도구 승인을 요청 중 — **사용자 입력 필요** |
| 🤔 | `thinking` | AI가 응답을 생성 중 |
| 🔧 | `tool` | 승인된 도구 실행 중 |
| ✅ | `done` | 응답 완료, 다음 지시 대기 중 |

## 상태 레이블

| 레이블 | 의미 |
|--------|------|
| `[Active]` | CPU 활동 감지됨 |
| `[Idle]` | 프로세스 활성 상태이나 최근 활동 없음 |
| `[Stalled]` | 식별된 세션이 한동안 활동 없는 상태 |
| `[Dead]` | 세션 파일은 있지만 프로세스가 종료됨 |
| `[Unmatched]` | AI 프로세스는 발견되었지만 알려진 세션으로 식별되지 않음 |

## tmux 연동

upstream [marmonitor-tmux](https://github.com/mjjo16/marmonitor-tmux) 플러그인은 기본 tmux 설정을 자동으로 처리합니다:

- 에이전트 뱃지와 어텐션 필이 포함된 2번째 상태 라인
- 팝업, 점프, 독 키 바인딩
- Option+1~5 다이렉트 점프

하지만 이 포크의 현재 상태줄 동작은 stock plugin 기본값보다 더 구체적이며, 아래와 같은 개인 tmux wiring을 추가로 전제합니다.

- collector 기반 statusline 서빙
- tmux 상태줄 진입점으로 `marmonitor-statusline` 사용
- tmux 클릭 라우팅에 `marmonitor-status-click` 사용
- clickable summary badge
- clickable detail item
- 오른쪽 rail의 clickable idle summary
- warm-idle Claude/Codex 세션을 보여주는 오른쪽 idle rail
- recent-complete와 warm-idle을 구분하는 statusline projection

즉 upstream 플러그인만 쓰면 baseline integration을 기대하면 되고, 이 README에 적힌 정확한 포크 동작은 collector + helper 바이너리까지 포함한 현재 개인 설정을 기준으로 이해하는 편이 맞습니다.

## 설정

설정 파일은 다음 순서로 탐색됩니다 (먼저 발견되는 것이 적용):

1. `$XDG_CONFIG_HOME/marmonitor/settings.json`
2. `~/.config/marmonitor/settings.json`
3. `~/.marmonitor.json`

```bash
# 현재 설정 파일 경로 및 값 확인
marmonitor settings-path
marmonitor settings-show

# 기본 설정 파일 생성
marmonitor settings-init --stdout
```

### 설정 예시

```json
{
  "display": {
    "attentionLimit": 10,
    "statuslineAttentionLimit": 5
  },
  "status": {
    "stalledAfterMin": 20,
    "phaseDecay": {
      "thinking": 20,
      "tool": 30,
      "permission": 0,
      "done": 5
    }
  },
  "integration": {
    "tmux": {
      "keys": {
        "attentionPopup": "a",
        "jumpPopup": "j",
        "dockToggle": "m",
        "directJump": ["M-1", "M-2", "M-3", "M-4", "M-5"]
      }
    }
  }
}
```

## 제거

```bash
marmonitor uninstall-integration    # tmux 설정 제거 + 상태바 복원
npm uninstall -g marmonitor         # CLI 제거
```

## 안전성

- **기본적으로 읽기 전용** — 관찰만 하며, 세션을 수정하지 않습니다
- **네트워크 미사용** — 외부 연결 없이 모든 데이터가 로컬에 유지됩니다
- **보수적인 기본값** — 모든 연동 기능은 옵트인 방식입니다
- **tmux 우선** — WezTerm/iTerm2 네이티브 지원은 현재 일시 중단 상태입니다

## 기여하기

설정, 커밋 규칙, PR 가이드라인은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요. 아키텍처 세부사항은 [ARCHITECTURE.md](ARCHITECTURE.md)를 확인하세요.

## 알려진 제한사항

- 패널 점프 기능은 tmux가 필요합니다
- WezTerm / iTerm2 네이티브 바 지원은 현재 일시 중단 상태이며, tmux가 지원되는 표면입니다
- Gemini 권한 감지는 Ink TUI 아키텍처로 인해 제한적입니다
- 단계 감지는 휴리스틱 기반으로, 에이전트별 정확도가 다를 수 있습니다
- macOS 우선 개발이며, Linux 지원은 미테스트 상태입니다

## 라이선스

[MIT](LICENSE) — MJ JO
