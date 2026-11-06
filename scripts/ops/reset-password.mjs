/**
 * reset-password.mjs — 운영자 비밀번호 재설정의 컨테이너 안쪽 절반.
 *
 * 직접 부르지 않는다. `scripts/ops/reset-password.sh <이메일>`이 운영 api 컨테이너의 node에
 * 이 파일을 표준 입력으로 흘려 넣는다(이미지를 다시 빌드하지 않아도 저장소의 지금 파일이 돈다):
 *
 *   docker compose ... exec -T -w /app/apps/api api node --input-type=module - <모드> [인자…] < reset-password.mjs
 *
 * 모드
 *   lookup <이메일>              읽기만 한다. 이메일·이름·살아 있는 로그인 수를 표준 오류로 보여 주고,
 *                                사용자 id 한 줄만 표준 출력으로 낸다(셸이 받아 apply에 넘긴다).
 *   apply  <이메일> <사용자 id>  임시 비밀번호를 만들어 바꾸고 그 사용자의 로그인·푸시 구독을 모두 끊는다.
 *                                lookup에서 운영자가 확인한 사람과 같은지 id로 다시 맞춘다.
 *   selftest                     DB 없이 임시 비밀번호 생성·해시·검증만 확인한다(값은 출력하지 않는다).
 *
 * 모듈 해석: 파일 위치가 아니라 작업 디렉터리(`-w /app/apps/api`) 기준으로 api가 쓰는
 * `@node-rs/argon2`·`postgres`를 찾는다 — pnpm은 앱마다 node_modules를 따로 두고 루트에 올리지 않는다.
 * DB 주소는 api 컨테이너가 이미 가진 DATABASE_URL이다(값은 어디에도 출력하지 않는다).
 *
 * 해시는 apps/api/src/auth/password.service.ts와 같다: `hash(pw, { algorithm: Algorithm.Argon2id })`,
 * 나머지 인자는 라이브러리 기본값(인자가 해시 문자열에 들어 있어 로그인의 verify가 그대로 읽는다).
 * 끊는 방식은 auth.service.ts의 changePassword를 따르고 한 단계를 더한다(모두 한 트랜잭션):
 *   1. user_sessions의 살아 있는 행에 revoked_at·revoked_reason='password_change'
 *      (재사용 유예 없이 즉시 401 — 유예는 'rotated'와 0045 이전 NULL만 받는다).
 *   2. 최근 24시간 안에 회전으로 끊긴 행도 revoked_reason만 'password_change'로 바꾼다(revoked_at은 그대로).
 *      refresh는 이런 옛 토큰을 '응답 유실 후 재시도'로 보고 비밀번호가 바뀌었는지 묻지 않은 채
 *      새 세션을 준다(REFRESH_REUSE_GRACE_MS 유예). 이 단계가 없으면 회전 응답을 놓친 기기나 토큰을
 *      훔친 쪽이 재설정 뒤에도 다시 들어온다 — 계정 침해 때문에 돌리는 경우에 침입자를 못 내보낸다.
 *      바꾼 뒤 그 토큰은 그 요청만 401이고 전 세션 무효화는 일어나지 않는다. 24시간은 api의
 *      REFRESH_REUSE_GRACE_MS와 같아야 한다. API의 revokeAllSessions(비밀번호 변경·재사용 탐지)도 같은 단계를 한다.
 *   3. push_subscriptions도 끊는다(다시 로그인하면 앱이 토큰을 다시 등록해 되살린다).
 * 남는 한계: 재설정과 거의 같은 순간(수 ms)에 이미 유예 판정을 지난 refresh 요청은 이유를 'rotated'로
 * 되돌리고 새 세션을 만들 수 있다 — changePassword와 같은 경쟁이라 API 쪽에서만 막을 수 있다.
 *
 * 임시 비밀번호는 apply의 표준 출력에 한 번만 쓴다. 파일·로그·오류 메시지에 넣지 않는다.
 */
import { randomInt } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 헷갈리는 글자(0·o, 1·l·i)와 대문자를 뺐다 — 불러 주거나 폰 자판으로 옮겨 칠 때 대소문자를 오가지 않게.
// 31글자 × 24자 ≈ 118비트라 대문자를 빼도 충분히 길다.
// 이름에 비밀 관련 단어를 넣지 않고 문자 집합을 식으로 만든다 — 긴 문자열 상수는 CI gitleaks(generic-api-key)가 비밀로 잡는다.
export const TEMP_CHARSET = "abcdefghijklmnopqrstuvwxyz"
  .split("")
  .filter((c) => !"ilo".includes(c))
  .concat("23456789".split(""))
  .join("");
export const TEMP_PASSWORD_LENGTH = 24;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 운영자가 고칠 수 있는 실패. 메시지만 보여 주고 이 종료 코드로 끝난다. */
export class ScriptError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** crypto.randomInt로 글자를 고른다(나머지 연산 편향 없음). */
export function generateTempPassword(length = TEMP_PASSWORD_LENGTH) {
  let password = "";
  for (let i = 0; i < length; i += 1) {
    password +=
      TEMP_CHARSET[randomInt(TEMP_CHARSET.length)];
  }
  return password;
}

/** AuthService.normalizeEmail과 같다 — 저장된 이메일은 소문자·앞뒤 공백 없음. */
export function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

/**
 * api의 PasswordService.hash와 같은 해시를 만들고, 쓰기 전에 같은 라이브러리로 다시 검증한다.
 * `argon2`는 `@node-rs/argon2` 모듈(api의 node_modules에서 불러온 것).
 */
export async function hashTempPassword(argon2, password) {
  const algorithm = argon2.Algorithm?.Argon2id;
  if (typeof algorithm !== "number") {
    throw new ScriptError(
      "@node-rs/argon2에서 argon2id 값을 찾지 못했어요 — 아무것도 바꾸지 않았어요.",
      2
    );
  }
  const passwordHash = await argon2.hash(password, { algorithm });
  const verified =
    passwordHash.startsWith("$argon2id$") &&
    (await argon2.verify(passwordHash, password));
  if (!verified) {
    throw new ScriptError(
      "만든 해시를 다시 검증하지 못했어요 — 아무것도 바꾸지 않았어요.",
      2
    );
  }
  return passwordHash;
}

/** 작업 디렉터리(/app/apps/api) 기준으로 api의 의존성을 불러온다. */
function requireFromApp(name) {
  const require = createRequire(join(process.cwd(), "reset-password.cjs"));
  try {
    return require(name);
  } catch {
    throw new ScriptError(
      `${name}을(를) 불러오지 못했어요 — api 컨테이너의 /app/apps/api 에서 실행해야 해요.`,
      2
    );
  }
}

const note = (line) => process.stderr.write(`[reset-password] ${line}\n`);

async function withDb(fn) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new ScriptError(
      "DATABASE_URL이 없어요 — 운영 api 컨테이너 안에서 실행해야 해요.",
      2
    );
  }
  const postgres = requireFromApp("postgres");
  // api의 createDbClient와 같은 옵션(prepare: false). 한 번 쓰고 닫으니 연결은 하나면 된다.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function findUser(sql, email) {
  const rows = await sql`
    select u.id, u.email, u.name, u.deleted_at,
      (select count(*)::int from user_sessions s
        where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as active_sessions
    from users u
    where u.email = ${email}
  `;
  const user = rows[0];
  if (!user) throw new ScriptError(`그 이메일의 사용자가 없어요: ${email}`, 3);
  if (user.deleted_at)
    throw new ScriptError(
      `삭제된 계정이에요: ${email} — 재설정하지 않아요.`,
      3
    );
  return user;
}

async function lookup(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) throw new ScriptError("이메일을 주세요.", 64);
  const user = await withDb((sql) => findUser(sql, email));
  note("대상 사용자");
  note(`  이메일: ${user.email}`);
  note(`  이름:   ${user.name}`);
  note(`  살아 있는 로그인: ${user.active_sessions}개 — 바꾸면 모두 끊겨요`);
  process.stdout.write(`${user.id}\n`);
}

async function apply(rawEmail, expectedId) {
  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) throw new ScriptError("이메일을 주세요.", 64);
  if (!UUID_PATTERN.test(String(expectedId ?? ""))) {
    throw new ScriptError(
      "사용자 id가 없거나 형식이 달라요 — reset-password.sh로 실행하세요.",
      64
    );
  }
  const argon2 = requireFromApp("@node-rs/argon2");
  // 해시는 트랜잭션 밖에서 먼저 만든다 — argon2가 수백 ms라 그동안 users 행을 잠가 둘 이유가 없다.
  const password = generateTempPassword();
  const passwordHash = await hashTempPassword(argon2, password);

  await withDb(async (sql) => {
    const counts = await sql.begin(async (tx) => {
      const rows = await tx`
        select id from users where email = ${email} and deleted_at is null for update
      `;
      if (rows.length !== 1 || rows[0].id !== expectedId) {
        throw new ScriptError(
          "확인한 뒤 대상이 바뀌었어요(이메일·삭제 상태). 아무것도 바꾸지 않았어요 — 처음부터 다시 실행하세요.",
          3
        );
      }
      await tx`
        update users set password_hash = ${passwordHash}, updated_at = now()
        where id = ${expectedId}
      `;
      const sessions = await tx`
        update user_sessions set revoked_at = now(), revoked_reason = 'password_change'
        where user_id = ${expectedId} and revoked_at is null
      `;
      // 유예 중인 옛 리프레시 토큰을 막는다(머리 주석 2번). 조건은 refresh의 graceEligible과 같고,
      // 언제 끊겼는지(revoked_at)는 기록으로 남겨 둔다.
      const graced = await tx`
        update user_sessions set revoked_reason = 'password_change'
        where user_id = ${expectedId}
          and revoked_at is not null
          and revoked_at >= now() - interval '24 hours'
          and (revoked_reason = 'rotated' or revoked_reason is null)
      `;
      const pushes = await tx`
        update push_subscriptions set revoked_at = now(), updated_at = now()
        where user_id = ${expectedId} and revoked_at is null
      `;
      return {
        sessions: sessions.count,
        graced: graced.count,
        pushes: pushes.count,
      };
    });
    // 커밋 직후, 연결을 닫기 전에 보여 준다 — 닫다가 실패해도 이미 바뀐 비밀번호를 잃지 않게.
    // 순서가 섞이지 않게 한 번에 표준 출력으로 쓴다(표준 오류와는 따로 흐른다).
    process.stdout.write(
      `[reset-password] 바꿨어요 — 로그인 ${counts.sessions}개와 푸시 구독 ${counts.pushes}개를 끊었어요.\n` +
        `[reset-password] 최근 24시간 안에 갱신돼 아직 다시 쓸 수 있던 옛 로그인 토큰 ${counts.graced}개도 막았어요.\n` +
        "\n" +
        `  임시 비밀번호: ${password}\n` +
        "\n" +
        "[reset-password] 이 비밀번호는 다시 볼 수 없어요(잃어버리면 이 스크립트를 다시 실행하세요).\n" +
        "[reset-password] 본인에게 직접 전하고, 로그인하자마자 전체 › 비밀번호 변경에서 바꾸게 해 주세요.\n"
    );
  });
}

async function selftest() {
  const argon2 = requireFromApp("@node-rs/argon2");
  const password = generateTempPassword();
  const allowed = new Set(TEMP_CHARSET);
  if (
    password.length !== TEMP_PASSWORD_LENGTH ||
    [...password].some((ch) => !allowed.has(ch))
  ) {
    throw new ScriptError("임시 비밀번호 모양이 다르다", 1);
  }
  const passwordHash = await hashTempPassword(argon2, password);
  if (await argon2.verify(passwordHash, generateTempPassword())) {
    throw new ScriptError("다른 비밀번호가 검증을 통과했다", 1);
  }
  note(
    `selftest 통과 — ${TEMP_PASSWORD_LENGTH}자, argon2id, 검증 일치·불일치 확인`
  );
}

export async function main(args) {
  const [mode, ...rest] = args;
  if (mode === "lookup" && rest.length === 1) return lookup(rest[0]);
  if (mode === "apply" && rest.length === 2) return apply(rest[0], rest[1]);
  if (mode === "selftest" && rest.length === 0) return selftest();
  throw new ScriptError(
    "사용법: lookup <이메일> | apply <이메일> <사용자 id> | selftest — 보통은 reset-password.sh로 실행해요.",
    64
  );
}

/** 표준 입력(`node -`)이나 파일로 직접 실행됐을 때만 돈다. 테스트에서 import하면 돌지 않는다. */
function isEntry() {
  const entry = process.argv[1];
  if (entry === "-") return true;
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof ScriptError) {
      note(`✗ ${error.message}`);
      process.exitCode = error.exitCode;
      return;
    }
    // 오류 객체 전체는 찍지 않는다(postgres 오류에는 쿼리 인자가 딸려 있다). 코드와 메시지만.
    const code =
      error && typeof error === "object" && "code" in error
        ? `[${error.code}] `
        : "";
    note(
      `✗ 예상하지 못한 오류: ${code}${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  });
}
