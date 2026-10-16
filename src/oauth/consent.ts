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
  error?: string;
}): string => {
  const err = opts.error
    ? `<p style="color:#b91c1c;background:#fef2f2;padding:10px 12px;border-radius:6px">${escapeHtml(opts.error)}</p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect eFactura</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:28px;max-width:420px;width:92%}
  h1{font-size:1.25rem;margin:0 0 6px} p.muted{color:#94a3b8;margin:0 0 18px;font-size:.9rem}
  label{display:block;font-size:.8rem;margin:12px 0 4px;color:#cbd5e1}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f8fafc}
  button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:white;font-weight:600;cursor:pointer}
  button:hover{background:#1d4ed8}
</style></head><body>
<div class="card">
  <h1>Connect Moldova eFactura</h1>
  <p class="muted">${escapeHtml(opts.clientName)} wants access to your SFS eFactura account.</p>
  ${err}
  <form method="post" action="${escapeHtml(opts.publicUrl)}/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(opts.clientId)}"/>
    <input type="hidden" name="redirect_uri" value="${escapeHtml(opts.redirectUri)}"/>
    <input type="hidden" name="state" value="${escapeHtml(opts.state)}"/>
    <input type="hidden" name="code_challenge" value="${escapeHtml(opts.codeChallenge)}"/>
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(opts.codeChallengeMethod)}"/>
    <input type="hidden" name="scope" value="${escapeHtml(opts.scope)}"/>
    <input type="hidden" name="resource" value="${escapeHtml(opts.resource)}"/>
    <label>eFactura username</label>
    <input name="username" autocomplete="username" required/>
    <label>eFactura password</label>
    <input name="password" type="password" autocomplete="current-password" required/>
    <button type="submit">Authorize</button>
  </form>
</div></body></html>`;
};

export const renderErrorPage = (title: string, message: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui;padding:2rem"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
