# marmonitor Repo Instructions

## Performance Architecture Reference
- 기능 추가, 리팩터링, 성능 최적화, collector/statusline/popup/jump 계열 설계 변경을 할 때는 먼저 [docs/marmonitor-performance-architecture-principles.txt](docs/marmonitor-performance-architecture-principles.txt)를 참고할 것.
- 이 문서는 제품 원칙 문서이면서 동시에 코드 작성 원칙 문서다.
- 특히 아래 판단에 우선 적용한다.
  - 이 변경이 실시간 / 준실시간 / 비실시간 중 어느 경로에 속하는가
  - 이 변경이 원본 상태 / 파생 상태 / 표현 결과 중 무엇을 다루는가
  - 이 변경이 공용 상태와 client 고유 상태의 경계를 흐리는가

## Simple Made Easy Alignment
- 구현은 "독립적이어야 할 것들이 분리 불가능하게 엮이고 있지 않은가"를 기준으로 검토할 것.
- 편한 위치에 로직을 추가하는 것보다, 이유가 같은 것끼리 같은 경계 안에 있도록 유지하는 것을 우선한다.
