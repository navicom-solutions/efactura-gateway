const CREATE_API_USER_URL = 'https://efactura.sfs.md/default.aspx#MySettings/CompanyUsers';

const STYLES = `
  :root{
    --bg:#ffffff;--fg:#0d0d0d;--muted:#6e6e80;--subtle:#8e8ea0;--border:#d9d9e3;--border-hover:#b4b4c4;
    --field:#ffffff;--focus:#10a37f;--focus-ring:rgba(16,163,127,.16);--primary:#0d0d0d;--primary-hover:#2f2f2f;
    --primary-fg:#ffffff;--surface:#f7f7f8;--danger:#d92d20;--danger-ring:rgba(217,45,32,.14);
    --radius:9999px;--ease:cubic-bezier(.2,.8,.2,1);
  }
  @media (prefers-color-scheme:dark){
    :root{
      --bg:#0d0d0d;--fg:#ececf1;--muted:#a1a1aa;--subtle:#8e8ea0;--border:#3f3f46;--border-hover:#52525b;
      --field:#171717;--focus-ring:rgba(16,163,127,.28);--primary:#ececf1;--primary-hover:#ffffff;
      --primary-fg:#0d0d0d;--surface:#171717;--danger:#f97066;--danger-ring:rgba(249,112,102,.2);
    }
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:"Söhne",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;
    font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;
    display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px}
  main{width:100%;max-width:360px;animation:rise .45s var(--ease) both}
  .mark{width:44px;height:44px;margin:0 auto 28px;border-radius:12px;background:var(--primary);color:var(--primary-fg);
    display:grid;place-items:center}
  h1{margin:0;text-align:center;font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-.02em}
  .lead{margin:10px 0 32px;text-align:center;color:var(--muted);font-size:15px}
  .lead strong{color:var(--fg);font-weight:500}
  .field{position:relative;margin-bottom:14px}
  .field input{width:100%;height:52px;padding:20px 20px 6px;border-radius:var(--radius);border:1px solid var(--border);
    background:var(--field);color:var(--fg);font:inherit;font-size:16px;outline:none;
    transition:border-color .15s var(--ease),box-shadow .15s var(--ease)}
  .field input:hover{border-color:var(--border-hover)}
  .field input:focus{border-color:var(--focus);box-shadow:0 0 0 4px var(--focus-ring)}
  .field label{position:absolute;left:21px;top:50%;transform:translateY(-50%);color:var(--subtle);font-size:16px;
    pointer-events:none;transform-origin:left center;transition:all .15s var(--ease)}
  .field input:focus + label,.field input:not(:placeholder-shown) + label{top:15px;font-size:12px}
  .field input:focus + label{color:var(--focus)}
  .field input[aria-invalid="true"]{border-color:var(--danger)}
  .field input[aria-invalid="true"]:focus{box-shadow:0 0 0 4px var(--danger-ring)}
  .field input[aria-invalid="true"] + label{color:var(--danger)}
  .error{display:flex;gap:6px;align-items:center;margin:-4px 0 14px 20px;color:var(--danger);font-size:13px;
    animation:fade .2s var(--ease) both}
  .error[hidden]{display:none}
  .error svg{flex:none}
  .field.has-toggle input{padding-right:76px}
  .toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);height:36px;padding:0 14px;border:0;border-radius:var(--radius);
    background:transparent;color:var(--muted);font:inherit;font-size:13px;font-weight:500;cursor:pointer;
    transition:background .15s var(--ease),color .15s var(--ease)}
  .toggle:hover{background:var(--surface);color:var(--fg)}
  .submit{position:relative;width:100%;height:52px;margin-top:6px;border:0;border-radius:var(--radius);
    background:var(--primary);color:var(--primary-fg);font:inherit;font-size:16px;font-weight:500;cursor:pointer;
    display:flex;align-items:center;justify-content:center;gap:10px;
    transition:background .15s var(--ease),transform .1s var(--ease),opacity .15s var(--ease)}
  .submit:hover{background:var(--primary-hover)}
  .submit:active{transform:scale(.985)}
  .submit:focus-visible{outline:none;box-shadow:0 0 0 4px var(--focus-ring)}
  .submit:disabled{cursor:progress;opacity:.86;transform:none}
  .spinner{display:none;width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;
    animation:spin .7s linear infinite}
  .submit.loading .spinner{display:inline-block}
  .secure{display:flex;gap:8px;align-items:center;justify-content:center;margin:18px 0 0;color:var(--subtle);font-size:13px}
  .help{margin-top:32px;padding:16px 18px;border-radius:16px;background:var(--surface);color:var(--muted);font-size:13px;line-height:1.55}
  .help strong{display:block;margin-bottom:4px;color:var(--fg);font-size:14px;font-weight:500}
  .help a{color:var(--fg);text-underline-offset:3px;text-decoration-color:var(--border-hover);transition:text-decoration-color .15s}
  .help a:hover{text-decoration-color:currentColor}
  .crumbs{color:var(--fg)}
  footer{margin-top:40px;color:var(--subtle);font-size:12px;text-align:center}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes fade{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

const MARK_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>`;
const ALERT_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>`;
const LOCK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

const layout = (title: string, body: string, script = ''): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/><meta name="robots" content="noindex"/>
<title>${escapeHtml(title)}</title><style>${STYLES}</style></head>
<body><main>${body}</main><footer>efactura-gateway</footer>${script}</body></html>`;

const CONSENT_SCRIPT = `<script>
  (function () {
    var form = document.querySelector('form');
    var btn = form.querySelector('.submit');
    var label = btn.querySelector('.label');
    var pwd = form.querySelector('input[name="password"]');
    var toggle = form.querySelector('.toggle');
    var error = document.getElementById('form-error');
    form.addEventListener('input', function () {
      if (error) error.hidden = true;
      form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    });
    toggle.addEventListener('click', function () {
      var show = pwd.type === 'password';
      pwd.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(show));
      pwd.focus();
    });
    form.addEventListener('submit', function () {
      btn.disabled = true;
      btn.classList.add('loading');
      label.textContent = 'Checking with SFS…';
    });
    window.addEventListener('pageshow', function () {
      btn.disabled = false;
      btn.classList.remove('loading');
      label.textContent = 'Continue';
    });
  })();
</script>`;

export const renderConsentPage = (opts: {
  publicUrl: string;
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string;
  username?: string;
  error?: string;
  /** Marks the credential fields as invalid (wrong or missing credentials). */
  invalid?: boolean;
}): string => {
  const hidden = {
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: opts.codeChallengeMethod,
    scope: opts.scope,
    resource: opts.resource,
  };
  const hiddenInputs = Object.entries(hidden)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}"/>`)
    .join('');
  const error = opts.error
    ? `<p class="error" id="form-error" role="alert">${ALERT_ICON}<span>${escapeHtml(opts.error)}</span></p>`
    : '';
  const invalid = opts.invalid ? ' aria-invalid="true" aria-describedby="form-error"' : '';
  const focusUsername = opts.username ? '' : ' autofocus';
  const focusPassword = opts.username ? ' autofocus' : '';

  return layout(
    'Connect eFactura',
    `<div class="mark">${MARK_ICON}</div>
  <h1>Connect Moldova eFactura</h1>
  <p class="lead"><strong>${escapeHtml(opts.clientName)}</strong> wants access to your SFS e-Factura account.</p>
  <form method="post" action="${escapeHtml(opts.publicUrl)}/authorize" novalidate>
    ${hiddenInputs}
    <div class="field">
      <input id="username" name="username" autocomplete="username" placeholder=" " spellcheck="false" autocapitalize="off" value="${escapeHtml(opts.username ?? '')}" required${invalid}${focusUsername}/>
      <label for="username">API username</label>
    </div>
    <div class="field has-toggle">
      <input id="password" name="password" type="password" autocomplete="current-password" placeholder=" " required${invalid}${focusPassword}/>
      <label for="password">API password</label>
      <button type="button" class="toggle" aria-pressed="false">Show</button>
    </div>
    ${error}
    <button type="submit" class="submit"><span class="spinner" aria-hidden="true"></span><span class="label">Continue</span></button>
  </form>
  <p class="secure">${LOCK_ICON}<span>Stored encrypted. Never shared with the AI assistant.</span></p>
  <div class="help">
    <strong>Don't have an API user?</strong>
    In e-Factura open <span class="crumbs">Setări → Utilizatorii Companiei</span> and
    <a href="${CREATE_API_USER_URL}" target="_blank" rel="noopener">create an API user</a>
    (role <span class="crumbs">API User</span>).
  </div>`,
    CONSENT_SCRIPT,
  );
};

export const renderErrorPage = (title: string, message: string): string =>
  layout(
    title,
    `<div class="mark">${MARK_ICON}</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="lead">${escapeHtml(message)}</p>`,
  );

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
