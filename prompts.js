/* ============================================================
   prompts.js — 기본 공통 지시문 (앱 기본값)

   index.html 이 <script src="prompts.js"> 로 먼저 불러온다.
   여기 넣은 지시문은 배포(GitHub Pages 등)하면 모든 사용자에게
   기본 공통 지시문으로 적용된다. builtinPresets 와 같은 '앱 기본값'.
   ※ 비어 있어도 됨 — 기본으로 넣을 것만 직접 채우세요.
   ※ 이 파일은 커밋/배포되므로 여기 넣은 내용은 공개됩니다.

   형식:
     window.BUILTIN_COMMON = [ { name, content, groups, role }, ... ]
       - name    : 목록에 뜨는 이름
       - content : 지시문 원문. 백틱 `...` 으로 감싸면 작은따옴표(character's)·
                   큰따옴표가 그대로 안전. 내용에 백틱( ` )이나 ${ 가 있으면
                   그 자리만 \`  ·  \${  로 이스케이프.
       - groups  : (생략 가능) ['world'|'character'|'prompt'] 배열.
                   생략하거나 'all' 이면 세 분류 전부 공용.
       - role    : (생략 가능) 기본 'system'. 'user'/'assistant' 도 가능.

   ※ 손으로 이스케이프하기 싫으면 prompt-editor.html 에서 GUI로 편집하고
     'prompts.js 내보내기'로 이 배열을 받아 아래에 붙여넣으면 된다.
   ============================================================ */
window.BUILTIN_COMMON = [
  // 예) { name:`문체 규칙`, content:`문장은 짧게. character's 처럼 ' 도 그대로.`, groups:['character'] },
];
