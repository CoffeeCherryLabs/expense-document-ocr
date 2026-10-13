# 지출 자동화 리소스와 운영 구조

검토일: 2026-10-12. 기존 회사 Notion의 허브·관리대장·수신함·평가·매뉴얼·운영 기록을 실시간으로 조회해 작성한 구조 안내입니다. 실제 지출·카드 매핑·원본·회사 설정값은 이 공개 저장소에 복제하지 않습니다.

## 원본과 책임

| 리소스 | 책임 | 갱신 주체 |
|---|---|---|
| Notion 법인 지출 관리대장 | 거래 1건당 1행, 사용자 보완, 결재·정산·회계 상태 | 실행기는 초안만 생성, 최종값·승인은 담당자 |
| Notion 증빙 수신함 | 원본 파일별 접수, Drive ID·수정시각·SHA256, 판독 결과, 연결 지출, 오류 | 실행기 및 수동 연결 담당자 |
| Notion OCR 테스트·평가 | 사람이 확인한 정답, 예측, 실패 유형과 재검증 기록 | 검증 담당자; 정답과 AI 예측 분리 |
| Drive 법인카드사용내역 | 영수증·전표·PDF·현장사진의 원본 | 지출자 업로드; 파일 정리는 비활성 |
| GitHub | 코드·파서·가상 회귀 테스트·규칙 버전·배포·실행 로그 | 개발 담당자 |
| GitHub Secrets | OAuth·Vision·Notion 인증, 최소 카드 매핑 | 권한 있는 운영자 |

메인 업무 DB는 기존 Notion 관리대장입니다. Drive의 CSV와 과거 Notion 보관 페이지는 과거 접수 자료로 유지하며 관리대장의 최신 상태를 별도로 덮어쓰지 않습니다. GitHub는 회계 원장이나 개인 데이터 보관소로 사용하지 않습니다.

## 기존 자산을 재사용하는 방식

1. 허브 페이지는 진입점으로 유지하고 관리대장·수신함·평가·운영 기록을 연결합니다.
2. 기존 제출 폼은 직접 작성 경로로 유지합니다. 사진 제출 폼의 존재는 기존 Worker 웹훅 동작을 보증하지 않으므로 Drive 자동 접수와 구분해 안내합니다.
3. 관리대장은 이미 결제 수단, 거래 식별키, 금액 대조, 사용자 확인, 결재·회계·RCMS 기록과 연구비 검토 필드를 갖추고 있습니다. 같은 정보를 별도 DB에 복제하지 않습니다.
4. 수신함의 연결 지출 관계로 여러 파일을 한 거래에 묶습니다. 파일 수와 거래 수를 같은 지표로 합산하지 않습니다.
5. 평가 DB는 실제 실패 사례를 회사 안에서 보존합니다. 공개 테스트에는 가상 문서·가상 카드만 넣습니다. OCR 핵심 필드 존재 비율은 필드 정확도와 다른 지표입니다.
6. 매뉴얼은 지출자·결재자·회계 담당자별 절차를 유지하고, 이전 Worker 설명은 별도 경로로 표시합니다. 운영 페이지에는 최신 활성화 상태와 마지막 실제 검증을 먼저 표시합니다.
7. 과제·협약·승인 예산·회사 정책이 미확정이면 기존 사전검토 체계를 유지합니다. 법인카드 확인만으로 연구비 인정·지급·회계 승인을 하지 않습니다.

## 자동 실행

Drive 업로드 → GitHub Actions 예약 실행 → Drive OAuth 읽기 → Google Vision OCR → 결정론적 파서 → Notion 수신함 → 거래 대조 → 지출 초안 또는 확인 필요.

- 예약 주기: 매시 13분·43분 UTC(한국시간도 매시 13분·43분). 약 30분 간격이며 플랫폼 지연이 가능합니다.
- 폴더와 하위 폴더의 지원 이미지/PDF를 읽고 1회 최대 20개 처리합니다. 핵심 거래 식별 정보가 부족하면 수신함에 남깁니다.
- 활성화: `EXPENSE_SYNC_ENABLED=true`. 파일 이동·이름 변경: `DRIVE_ORGANIZE_ENABLED=false` 유지.
- 담당자는 수신함의 실패·확인 필요와 관리대장의 작성 중·보완 필요를 확인합니다. 목적·참가자·과제는 영수증만으로 채우지 않습니다.
- 중단: Actions repository variable `EXPENSE_SYNC_ENABLED=false`로 변경합니다. 배포 코드는 main의 이전 정상 버전으로 되돌릴 수 있지만 Notion 쓰기는 별도로 검토·복구해야 합니다.
- 현재는 Notion을 영속 체크포인트로 사용합니다. 원자적 UNIQUE 제약이 없으므로 같은 concurrency 그룹과 실행기 1개를 유지합니다.
- Drive 정리는 [별도 주간 작업](WEEKLY-ORGANIZATION.md)으로 분리합니다. 최초에는 미리보기 보고만 실행하고, 사람의 원본 대조·사용자 확인이 끝난 증빙에 한해 이동 스위치를 별도로 켭니다.
- 처리량·동시 실행·감사 이력 요구가 커지면 별도 트랜잭션 DB와 큐를 도입하고 Notion을 운영 화면으로 유지하는 것을 검토합니다. 지금 단계에서는 이전하지 않습니다.

## 자동화와 LLM의 역할

| 기능 | 현재 담당 |
|---|---|
| 실행 시간, 인증, 파일 수집·재시도·중복 대조 | GitHub Actions와 TypeScript 코드 |
| 문자 판독 | Google Vision |
| 금액·날짜·승인번호·끝자리 추출 | 테스트 가능한 파서 |
| 정산·검토 상태 관리 | Notion DB와 담당자 |
| 오류 원인 분석·코드 개선 | Codex/Claude 등 개발 에이전트 |
| 누락 정보 안내·문서 요약 | 선택적으로 Notion AI 또는 LLM, 제안으로 저장 |
| 결재·회계 확정 | 사람 |

LLM은 실행 스케줄러나 메인 DB가 아닙니다. 모델을 추가한다면 출력 스키마 검증, 근거 원본, 재시도 비용, 사용 한도와 사람 확인을 먼저 정의합니다. Notion Custom Agents는 자동 트리거·예약이 가능하지만 Notion credits를 사용합니다. Notion Workers도 현재 크레딧 사용 대상이므로 기존 문서의 '함수이므로 AI 크레딧 없음' 문구를 비용 보증으로 취급하지 않습니다. 지금 가동하는 Actions 실행기는 Notion Custom Agent/Worker를 호출하지 않고 Notion API에 직접 기록합니다.

## 확인된 문서상 개선점

- 과거 '클라우드 미가동' 안내와 개인 GitHub 주소를 최신 실행 상태 및 조직 주소로 갱신합니다.
- 기존 Worker의 웹훅은 현재 코드에서 비밀 헤더가 필요합니다. 초기 '별도 헤더 없음' 안내를 그대로 적용하지 않습니다.
- 원본 보관 페이지의 초기 거래 집계는 역사 기록으로 유지하고 최신 통계는 관리대장에서 조회합니다.
- 평가·수신함·관리대장 사이의 추가 관계나 카드 레지스트리 DB는 필요가 확인될 때 도입합니다. 지금은 기존 관계·필드·최소 Secrets 매핑을 재사용합니다.

## 공식 문서

- [GitHub 예약 실행의 지연과 휴면 제한](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Notion 데이터베이스 자동화](https://www.notion.com/help/database-automations)
- [Notion Custom Agents](https://www.notion.com/help/custom-agents)
- [Notion Custom Agents 크레딧](https://www.notion.com/help/buy-and-track-notion-credits-for-custom-agents)
- [Notion Workers 크레딧](https://www.notion.com/help/understand-pricing-for-workers)
- [Google Vision 요금](https://cloud.google.com/vision/pricing)
