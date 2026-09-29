# Family Budget

Shared household budget for Albert and Ruth. It's a PWA on Cloudflare Pages, with Pages Functions and D1 for sync and Cloudflare Access for sign-in.

```
public/            the app (static files)
functions/api/     sync API + Access JWT check (_middleware.js)
```

- `GET /api/me`: returns who is signed in.
- `GET /api/sync?since=REV`: returns records changed since REV.
- `POST /api/sync`: pushes changes. Last write wins per record, by modified time.
- `GET /api/export`: returns a full backup.

The database table is created automatically on the first request.

**Env vars**
- `TEAM_DOMAIN`: e.g. `sunday-family.cloudflareaccess.com`.
- `POLICY_AUD`: the Access application's AUD tag.
- `PEOPLE`: e.g. `alberteddy99@gmail.com:Albert,ruthldsk@gmail.com:Ruth`.

**D1 binding:** `DB`.

**Local dev:**
1. Create `.dev.vars` with `DEV_EMAIL=...` and `PEOPLE=...`.
2. Run `npx wrangler pages dev public --d1 DB=local`.
3. `DEV_EMAIL` only works on localhost. Never set it in production.
