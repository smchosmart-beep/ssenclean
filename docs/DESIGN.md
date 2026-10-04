---
version: 1.0
name: SEN-Clean-design
description: 쎈(SEN) 제품군 공통 디자인 언어를 쎈클린에 적용한 버전. 따뜻한 크림색 캔버스 위에 흰색 패널을 띄우고, 짙은 초록을 브랜드색으로 쓴다. 모든 버튼은 쎈PDF 도구 버튼과 같은 한 가지 모양(흰 바탕·회색 테두리·8px 모서리·아이콘+글자)이다. 쎈PDF와 같은 토큰을 공유하고, 쎈클린에서는 점검 결과를 보여주는 상태색 4종(빨강·주황·초록·회색)만 추가한다.

colors:
  canvas: "#F2F0EB"
  surface: "#FFFFFF"
  brand: "#006241"
  primary: "#00754A"
  primary-press: "#005A39"
  on-primary: "#FFFFFF"
  mint: "#D4E9E2"
  mint-line: "#00754A"
  ink: "#1F1F1F"
  ink-mute: "#555555"
  hairline: "#E3E0D8"
  btn-line: "#D9D5CC"
  mask: "#4B4B4B"
  toast: "#1E3932"
  danger: "#C23B22"
  danger-bg: "#FBEAE6"
  warn: "#B25E09"
  warn-bg: "#FDF1E2"
  ok: "#00754A"
  ok-bg: "#E6F2EC"
  info: "#6B6B6B"
  info-bg: "#EFEDE8"

typography:
  display:
    fontFamily: "Hakgyoansim Jayeon, Cafe24 PRO Slim, sans-serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.25
  dday:
    fontFamily: "Hakgyoansim Jayeon, Cafe24 PRO Slim, sans-serif"
    fontSize: 22px
    fontWeight: 400
    lineHeight: 1.2
  heading:
    fontFamily: "Cafe24 PRO Slim, Hakgyoansim Jayeon, sans-serif"
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.35
  title:
    fontFamily: "Cafe24 PRO Slim, Hakgyoansim Jayeon, sans-serif"
    fontSize: 19px
    fontWeight: 700
    lineHeight: 1.4
    color: "#111111"
  body:
    fontFamily: "Cafe24 PRO Slim, Hakgyoansim Jayeon, sans-serif"
    fontSize: 16px
    fontWeight: 300
    lineHeight: 1.55
  button:
    fontFamily: "Hakgyoansim Jayeon, Cafe24 PRO Slim, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.0
  caption:
    fontFamily: "Cafe24 PRO Slim, Hakgyoansim Jayeon, sans-serif"
    fontSize: 15px
    fontWeight: 300
    lineHeight: 1.45
  tag:
    fontFamily: "Cafe24 PRO Slim, Hakgyoansim Jayeon, sans-serif"
    fontSize: 14px
    fontWeight: 300
    lineHeight: 1.0

rounded:
  sm: 8px
  md: 10px
  lg: 16px
  pill: 999px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 28px

shadow:
  panel: "0 1px 3px rgba(31,31,31,.06), 0 6px 20px rgba(31,31,31,.05)"
  toast: "0 6px 20px rgba(0,0,0,.18)"

components:
  app-header:
    backgroundColor: "{colors.surface}"
    height: 72px
    border: "1px solid {colors.hairline} (bottom)"
    padding: 0 24px
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    shadow: "{shadow.panel}"
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.btn-line}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    height: 42px
    padding: 0 16px
    icon: 18px line icon, stroke 2px, gap 7px, centered
  button-active:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.brand}"
    border: "1px solid {colors.mint-line}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    border: "1px solid {colors.primary}"
  button-primary-pressed:
    backgroundColor: "{colors.primary-press}"
  nav-item:
    base: "{components.button}"
    width: 100%
    align: left
    gap-between-items: 8px
  nav-item-active:
    base: "{components.button-active}"
  status-row:
    padding: 14px 24px
    divider: "1px solid {colors.hairline}"
  status-icon:
    size: 36px
    rounded: "{rounded.md}"
  status-tag:
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: 3px 10px
  drop-zone:
    backgroundColor: "{colors.mint}"
    border: "2px dashed {colors.mint-line}"
    rounded: "{rounded.lg}"
  toast:
    backgroundColor: "{colors.toast}"
    textColor: "{colors.on-primary}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: 13px 22px
  privacy-mask:
    backgroundColor: "{colors.mask}"
    opacity: 1
---

## Overview

쎈클린은 쎈PDF와 같은 집에 사는 프로그램이다. 크림색 캔버스(`{colors.canvas}`) 위에 흰 패널(`{colors.surface}`)이 은은한 그림자로 떠 있고, 브랜드는 짙은 초록(`{colors.brand}`), 모든 버튼은 쎈PDF 도구 버튼과 같은 한 가지 모양으로 통일한다. 사용자가 "쎈 프로그램이구나"를 색과 모양만으로 알아보게 하는 것이 목표다.

쎈클린이 쎈PDF와 다른 점은 **점검 결과를 보여주는 화면**이라는 것이다. 그래서 공통 토큰 위에 상태색 4종만 추가한다. 다른 색은 추가하지 않는다.

**핵심 특징**
- 크림색 캔버스 + 흰 패널 + 한 가지 모양의 버튼: 쎈 제품군 공통
- 선택·활성 상태는 연한 민트(`{colors.mint}`)와 초록 테두리: 쎈PDF의 선택 페이지·드롭 영역과 같은 규칙
- 상태색은 글자색 + 연한 배경 쌍으로만 쓴다(넓은 면을 빨강·주황으로 칠하지 않는다)
- 버튼·큰 안내 문구·D-day 숫자는 학교안심 자연, 제목은 Cafe24 Bold, 나머지는 Cafe24 Air

## Colors

### 공통 (쎈PDF와 동일)
| 토큰 | 값 | 쓰임 |
|---|---|---|
| `canvas` | `#F2F0EB` | 전체 배경 |
| `surface` | `#FFFFFF` | 헤더, 패널, 대화상자 |
| `brand` | `#006241` | 로고, 제목, 활성 메뉴 글자, 아이콘 선 |
| `primary` | `#00754A` | 화면당 1개 주요 버튼 배경(헤더 오른쪽), 활성 테두리 |
| `btn-line` | `#D9D5CC` | 버튼 테두리 |
| `primary-press` | `#005A39` | 주요 버튼 눌림 |
| `mint` | `#D4E9E2` | 선택된 항목, 드롭 영역, 활성 메뉴 배경 |
| `ink` / `ink-mute` | `#1F1F1F` / `#555555` | 본문 / 보조 문구 (가는 글꼴이라 보조 문구도 진하게) |
| `hairline` | `#E3E0D8` | 1px 구분선, 보조 버튼 테두리 |
| `mask` | `#4B4B4B` | 개인정보 가림, 불투명도 100% |
| `toast` | `#1E3932` | 알림 토스트 배경 |

### 상태색 (쎈클린 추가)
| 상태 | 글자·아이콘 | 배경 | 대시보드 태그 문구 |
|---|---|---|---|
| 🔴 위험 | `danger #C23B22` | `danger-bg #FBEAE6` | 바로 해결 |
| 🟠 권장 | `warn #B25E09` | `warn-bg #FDF1E2` | 해결 권장 |
| 🟢 안전 | `ok #00754A` | `ok-bg #E6F2EC` | 안전 |
| ⚪ 정보·확인 불가 | `info #6B6B6B` | `info-bg #EFEDE8` | 정보 / 확인할 수 없어요 |

- 상태색 글자는 흰 배경과 연한 배경 모두에서 대비 4.5:1 이상이 되도록 고른 값이다.
- 색만으로 상태를 전하지 않는다. 항상 아이콘 + 태그 문구를 같이 쓴다.

## Typography

### 글꼴
- **Cafe24 PRO Slim** (앱 내장, 같은 이름으로 두 굵기를 등록)
  - Air (`assets/fonts/Cafe24PROSlim-Air.otf`, weight 300): 본문, 설명, 태그
  - Bold (`assets/fonts/Cafe24PROSlim-Bold.otf`, weight 700): 행·카드 제목, 메뉴 화면 제목
- **학교안심 자연** (`assets/fonts/Hakgyoansim_JayeonR.ttf`, 앱 내장): **모든 버튼(왼쪽 메뉴 포함)**, 대시보드 큰 안내 문구, D-day 숫자. 쎈PDF 도구 버튼과 같다.
- 맑은 고딕은 쓰지 않는다. 시스템 글꼴에 의존하지 않는다.

```css
@font-face { font-family: "Cafe24 PRO Slim"; src: url(fonts/Cafe24PROSlim-Air.otf);  font-weight: 300; }
@font-face { font-family: "Cafe24 PRO Slim"; src: url(fonts/Cafe24PROSlim-Bold.otf); font-weight: 700; }
@font-face { font-family: "Hakgyoansim Jayeon"; src: url(fonts/Hakgyoansim_JayeonR.ttf); }
body { font: 300 16px/1.55 "Cafe24 PRO Slim", "Hakgyoansim Jayeon", sans-serif; font-synthesis: none; }
```

### 크기
| 역할 | 글꼴 | 크기 | 쓰임 |
|---|---|---|---|
| `display` | 학교안심 자연 | 28px | "해결할 일이 4개 있어요", "내 PC가 안전해요" |
| `dday` | 학교안심 자연 | 22px | PC암호 D-day 숫자 |
| `heading` | Cafe24 Bold | 22px | 메뉴 화면 제목 |
| `title` | Cafe24 Bold | 19px, `#111` | 행·카드 제목 (예: "PC암호가 없어요") |
| `body` | Cafe24 Air | 16px | 본문 |
| `caption` | Cafe24 Air | 15px, `#555` | 설명 (예: "자리를 비우면 누구나 이 PC를 열 수 있어요.") |
| `tag` | Cafe24 Air | 14px | 상태 태그 |
| `button` | 학교안심 자연 | 15px | 모든 버튼 글자, 왼쪽 메뉴 |

### 규칙
- Cafe24는 300(Air)과 700(Bold) 두 굵기만 쓴다. 400·500·600을 지정하면 가까운 굵기로 바뀌어 의도와 달라지므로 쓰지 않는다.
- `font-synthesis: none`을 켜서 가짜 굵게·기울임을 막는다.
- 14px 미만은 쓰지 않는다.
- 두 굵기 모두 한글 2,780자(KS X 1001 범위)만 들어 있다. 드문 글자와 기호 `· — › ✓ ①` 등은 다음 순서의 학교안심 자연으로 표시된다. 파일명처럼 임의 글자가 나오는 곳에서도 깨지지 않도록 글꼴 목록 두 번째에 학교안심 자연을 항상 둔다.
- 화면 문구에는 `—` 대신 `-`, `·` 대신 쉼표를 쓰면 글꼴이 섞이지 않아 깔끔하다.

## Layout

```
┌ 헤더 72px (흰색) ─ 로고 · 버전 ············ [설정] [● 다시 점검] ┐
├──────────────┬───────────────────────────────────────────┤
│ 메뉴 패널 232px │ 내용 영역 (패널 단위로 쌓음, 간격 14~16px)        │
│ 흰색, 16px 모서리│                                           │
└──────────────┴───────────────────────────────────────────┘
```
- 바깥 여백 16px, 패널 사이 14~16px, 패널 안쪽 24~28px
- 창 기본 1280×800, 최소 1024×700
- 헤더 오른쪽에는 화면의 주요 동작 1개만 초록 버튼으로 둔다(대시보드는 [다시 점검]). 모양은 일반 버튼과 같고 색만 다르다.

## Components

### 버튼 (모든 버튼 공통)
쎈PDF의 [추출] [복제] [회전] [삭제] [쪽번호] 버튼과 같은 모양 하나만 쓴다.
```
┌────────────────┐
│  ⎘  추출        │   높이 42px · 흰 바탕 · 1px #D9D5CC 테두리 · 8px 모서리
└────────────────┘   아이콘 18px(선 2px) + 학교안심 자연 15px, 가운데 정렬
```
- **`button`**: 기본. 메뉴, 상태 행의 해결 버튼, 대화상자 보조 버튼 모두 이것을 쓴다.
- **`button-active`**: 선택·현재 상태. 민트 바탕 + 초록 테두리 + 초록 글자.
- **`button-primary`**: 화면의 가장 중요한 동작 1개(헤더 [다시 점검], 대화상자 확인)에만 초록 바탕 + 흰 글자. 모양은 `button`과 동일하다.
- 알약형(완전 둥근) 버튼, 테두리 없는 텍스트 버튼, 아이콘만 있는 버튼은 쓰지 않는다.
- 같은 줄·같은 목록의 버튼은 너비를 맞춘다(상태 행 140px, 메뉴 100%).

### 메뉴 (`nav-item`)
- `button`을 세로로 쌓고 간격 8px, 너비 100%, 내용은 왼쪽 정렬
- 아이콘 + 메뉴명(학교안심 자연 15px) + 오른쪽 상태 점(9px, 빨강·주황·초록)
- 현재 메뉴: `button-active`
- 상태 점은 문제가 없을 때 초록, 확인하지 않았거나 해당 없으면 점을 숨긴다.

### 대시보드 상태 행 (`status-row`)
```
[아이콘 36px] 제목(Cafe24 Bold 19px)                 [태그]  [해결 버튼]
             설명(Cafe24 Air 15px 회색)
```
- 아이콘 칸은 상태 배경색 + 상태색 선 아이콘
- 해결 버튼은 상태와 관계없이 모두 같은 `button`(아이콘 + 글자, 너비 140px). 위험 정도는 태그와 아이콘 칸 색으로만 구분한다.
- 행 사이 1px 구분선, 패널 하나에 모든 행을 담는다.
- 정렬: 위험 → 권장 → 안전 → 정보
- PC암호 행은 버튼 대신 D-day 숫자(`dday`)를 오른쪽에 둘 수 있다.

### 그 밖의 요소
- **토스트**: 짙은 초록 배경(`toast`), 흰 굵은 글자, 화면 아래 가운데. 2.5초 뒤 사라진다. 쎈PDF의 "1페이지를 가져왔습니다" 토스트와 같다.
- **드롭 영역**(개인정보 검사 폴더 추가 등): 민트 바탕 + 초록 점선 테두리
- **개인정보 미리보기 가림**: `mask` 진회색, 불투명도 100%. 문자 마스킹(`900101-1******`)을 기본으로 하고, 이미지 미리보기에서만 가림 박스를 쓴다.
- **확인 대화상자**: 흰 패널, 16px 모서리, 확인 버튼은 오른쪽 `button-primary`, 취소는 `button`. 되돌릴 수 없는 작업이면 버튼만 `danger` 배경으로 바꾸고 본문에 "되돌릴 수 없어요"를 빨간 글씨로 쓴다.

## Logo

- `assets/logo.svg`: 가나초콜릿 글꼴의 "쎈클린"을 윤곽선으로 변환한 SVG, 색은 `brand #006241`
- 헤더 높이 34px 기준으로 넣고, 오른쪽에 버전(13px 회색)을 둔다.

## Do / Don't

### Do
- 모든 버튼에 같은 `button` 모양을 쓰고, 아이콘과 글자를 항상 같이 넣는다.
- 쎈PDF와 같은 토큰 값을 그대로 쓴다. 공통 값을 바꾸면 쎈PDF도 함께 바꾼다.
- 위험·권장 상태는 연한 배경 + 진한 글자 조합으로만 표시한다.
- 모든 상태에 아이콘과 문구를 같이 붙인다.

### Don't
- 상태색 외에 새 강조색을 추가하지 않는다.
- 패널 전체나 헤더를 빨강·주황으로 칠하지 않는다. 불안감을 키운다.
- 점수, 게이지, 원형 그래프를 쓰지 않는다. "해결할 일 N개"로 충분하다.
- 학교안심 자연을 본문·설명·목록에 쓰지 않는다(버튼·큰 안내 문구·D-day 전용).
- 버튼 글자에 Cafe24 Air를 쓰지 않는다.
- 맑은 고딕을 쓰지 않는다.
- Cafe24에 300·700 외의 굵기를 주지 않는다.
- 초록 `button-primary`를 한 화면에 두 개 이상 두지 않는다.
- 버튼마다 모양·높이·모서리를 다르게 만들지 않는다.
