import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { GoogleDriveService } from './google-drive.service';

/**
 * Public (unauthenticated) route for the Google OAuth redirect.  Google
 * sends the user's browser here with a `?code=…` after consent — we
 * exchange it for a refresh_token and render a tiny self-closing page that
 * pings `window.opener` so the Settings popup can refresh itself.
 *
 * Kept in a separate controller because BackupsController is wrapped in
 * `JwtAuthGuard + AdminGuard`, and we can't put those on the redirect URL.
 */
@Controller('backups/drive')
export class DriveOAuthCallbackController {
  constructor(private readonly drive: GoogleDriveService) {}

  @Get('oauth-callback')
  async callback(@Query('code') code: string, @Query('error') error: string, @Res() res: Response) {
    if (error) {
      res.status(400).send(htmlPage(false, `Google returned: ${error}`));
      return;
    }
    if (!code) {
      res.status(400).send(htmlPage(false, 'Missing ?code query param'));
      return;
    }
    try {
      const { email } = await this.drive.finishOAuth(code);
      res.send(htmlPage(true, `Connected as ${email || 'your Google account'}.`));
    } catch (err: any) {
      res.status(400).send(htmlPage(false, err?.message || 'OAuth exchange failed'));
    }
  }
}

function htmlPage(ok: boolean, msg: string) {
  const color = ok ? '#118f4e' : '#b91c1c';
  const title = ok ? 'Google Drive connected' : 'Connection failed';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8faf8;color:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 40px;max-width:480px;box-shadow:0 6px 30px rgba(15,23,42,.06);text-align:center}
.h{font-size:20px;font-weight:700;color:${color};margin-bottom:8px}
.m{font-size:14px;color:#475569;line-height:1.5}.b{margin-top:18px;display:inline-block;padding:8px 16px;border-radius:8px;background:${color};color:#fff;font-size:13px;font-weight:600;cursor:pointer;border:0}</style></head>
<body><div class="card"><div class="h">${title}</div><div class="m">${msg}</div>
<button class="b" onclick="window.close();window.opener&&window.opener.postMessage({type:'gdrive_oauth_done',ok:${ok}},'*');">Close</button></div>
<script>try{window.opener&&window.opener.postMessage({type:'gdrive_oauth_done',ok:${ok}},'*');}catch(e){}setTimeout(function(){try{window.close();}catch(e){}},1500);</script>
</body></html>`;
}
