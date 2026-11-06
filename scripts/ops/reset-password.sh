#!/bin/sh
# =============================================================================
# reset-password.sh — 운영자용 비밀번호 재설정(임시 비밀번호 발급)
# -----------------------------------------------------------------------------
# ## 왜 있나
#
# 모아에는 메일 발송 기능이 없어 사용자가 스스로 비밀번호를 되찾을 수 없다(API에 forgot/reset
# 경로·SMTP 없음). 로그인 화면의 '비밀번호를 잊었어요' 안내가 "앱을 관리하는 가족에게 임시
# 비밀번호를 받으라"고 말하고, 그 가족(운영자)이 이 스크립트를 돌린다. 전에는 운영 DB를 직접
# 손대는 수밖에 없었다.
#
# ## 하는 일
#
#   1. 운영 api 컨테이너 안에서 이메일로 사용자를 찾아 이메일·이름을 보여 준다(읽기만).
#      없거나 삭제된 계정이면 실패한다.
#   2. y로 확인하면(--yes면 묻지 않는다) 임시 비밀번호(24자, 헷갈리는 글자·대문자 제외)를 만들어
#      api와 같은 argon2id로 해시해 바꾸고, 그 사용자의 로그인(리프레시 세션)과 푸시 구독을
#      모두 끊는다 — 앱의 '비밀번호 변경'과 같은 처리에, 최근 24시간 안에 갱신돼 아직 유예로
#      다시 쓸 수 있는 옛 리프레시 토큰까지 막는 단계를 더했다(계정 침해 때 침입자가 그 토큰으로
#      다시 들어오지 못하게 — 자세한 이유는 reset-password.mjs 머리 주석).
#      한 트랜잭션이라 중간에 실패하면 그대로다.
#   3. 임시 비밀번호를 표준 출력에 한 번만 보여 준다. 파일·로그에 남기지 않는다.
#
# ## 사용 (저장소 루트 어디서든)
#
#   sh scripts/ops/reset-password.sh <이메일>          # 이메일·이름을 보여 주고 y를 묻는다
#   sh scripts/ops/reset-password.sh <이메일> --yes    # 확인을 묻지 않는다
#
# ## 주의
#
#   - 운영자만 돌린다. deploy.sh와 같은 운영 compose(.env + .env.production + docker-compose.prod.yml)의
#     api 컨테이너에 붙어 **운영 DB의 비밀번호를 실제로 바꾼다**.
#   - 임시 비밀번호는 본인에게 직접 전하고, 로그인하자마자 전체 › 비밀번호 변경에서 바꾸게 한다.
#   - 출력을 파이프·파일로 돌리지 않는다(| tee, > 파일). 표준 출력이 터미널이 아니면 시작하지 않는다.
#     다른 기기에서 붙을 때는 ssh -t 로. docker exec의 출력은 컨테이너 로그(docker logs·Dozzle)에
#     남지 않는다 — 남는 곳은 이 터미널의 스크롤뿐이니 전한 뒤 지운다.
#   - 대상은 모든 기기에서 로그아웃된다. 이미 받은 액세스 토큰은 짧은 수명이 끝날 때까지만 돈다.
#     재설정과 거의 같은 순간(수 ms)에 돌던 토큰 갱신 하나는 막지 못할 수 있다 — 침해가 의심되면
#     몇 분 뒤 한 번 더 돌린다(API 쪽에서만 완전히 막을 수 있다).
#   - 이미지를 다시 빌드할 필요 없다. 같은 폴더의 reset-password.mjs를 표준 입력으로 컨테이너의
#     node에 흘려 넣는다(작업 디렉터리 /app/apps/api — api의 @node-rs/argon2·postgres를 쓴다).
#
# 종료 코드: 0 성공 · 1 취소/실패 · 2 실행 환경 문제 · 3 대상 문제(없음·삭제됨·바뀜) · 64 사용법 오류
# =============================================================================
set -eu

usage() {
  cat <<'USAGE'
사용법: sh scripts/ops/reset-password.sh <이메일> [--yes]
  운영 api 컨테이너에서 그 사용자의 비밀번호를 임시 비밀번호로 바꾸고 모든 기기에서 로그아웃합니다.
  --yes   이메일·이름 확인 질문을 건너뜁니다.
USAGE
}

email=""
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) assume_yes=1 ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "[reset-password] ✗ 모르는 옵션: $arg" >&2
      usage >&2
      exit 64
      ;;
    *)
      if [ -n "$email" ]; then
        echo "[reset-password] ✗ 이메일은 하나만 받아요" >&2
        exit 64
      fi
      email="$arg"
      ;;
  esac
done

if [ -z "$email" ]; then
  usage >&2
  exit 64
fi
case "$email" in
  *[[:space:]]*|*@*@*|@*|*@) bad_email=1 ;;
  *@*) bad_email=0 ;;
  *) bad_email=1 ;;
esac
if [ "$bad_email" -ne 0 ]; then
  echo "[reset-password] ✗ 이메일 형식이 아니에요: $email" >&2
  exit 64
fi

# 임시 비밀번호가 파이프·파일로 새지 않게, 터미널에 직접 보여 줄 수 있을 때만 시작한다.
if [ ! -t 1 ]; then
  echo "[reset-password] ✗ 표준 출력이 터미널이 아니에요 — 임시 비밀번호가 파일·로그에 남을 수 있어 멈춰요." >&2
  echo "                 터미널에서 직접 실행하세요(다른 기기에서는 ssh -t)." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$script_dir/../.." && pwd)"
cd "$repository_root"
node_script="$script_dir/reset-password.mjs"

for required in "$node_script" .env .env.production docker-compose.prod.yml; do
  if [ ! -f "$required" ]; then
    echo "[reset-password] ✗ $required 가 없어요 — 운영 저장소 루트에서 실행하는지 확인하세요." >&2
    exit 2
  fi
done

compose() {
  docker compose \
    --env-file .env \
    --env-file .env.production \
    -f docker-compose.prod.yml \
    "$@"
}

# 운영 api 이미지는 저장소 전체를 /app에 두고 pnpm이 앱마다 node_modules를 둔다. 작업 디렉터리를
# /app/apps/api로 잡아야 api가 쓰는 의존성을 찾는다. 스크립트는 표준 입력으로 넘겨, 이미지에 아직
# 없는 파일이어도 지금 저장소의 것이 돈다.
in_api() {
  compose exec -T -w /app/apps/api api node --input-type=module - "$@" <"$node_script"
}

if [ -z "$(compose ps --status running -q api 2>/dev/null)" ]; then
  echo "[reset-password] ✗ 운영 api 컨테이너가 떠 있지 않아요 — deploy.sh로 먼저 올리세요." >&2
  exit 2
fi

echo "[reset-password] 대상을 찾아요(읽기만)"
user_id="$(in_api lookup "$email")" || exit $?
case "$user_id" in
  ''|*[!0-9a-f-]*)
    echo "[reset-password] ✗ 사용자 id를 읽지 못했어요 — 아무것도 바꾸지 않았어요." >&2
    exit 1
    ;;
esac

if [ "$assume_yes" -ne 1 ]; then
  printf '[reset-password] 이 사용자의 비밀번호를 임시 비밀번호로 바꾸고 모든 기기에서 로그아웃할까요? [y/N] '
  answer=""
  read -r answer || answer=""
  case "$answer" in
    y|Y|yes|YES) ;;
    *)
      echo "[reset-password] 그만뒀어요. 아무것도 바꾸지 않았어요."
      exit 1
      ;;
  esac
fi

# 출력은 받아 두지 않고 그대로 터미널로 보낸다 — 임시 비밀번호가 변수·파일에 남지 않게.
in_api apply "$email" "$user_id"
