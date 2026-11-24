# Premium Streamers Server

A responsive application page plus a password-protected admin dashboard. The server validates access codes **on the backend**. Applicants cannot invent codes or choose a different inviter from the one attached to their code.

## Features
- Dark navy / cyan design based on the supplied reference.
- Separate access codes for Elite, Dexil and Daniel.
- Invalid codes show an error and do not submit an application.
- Admin can create, disable and delete codes.
- Admin can review applications and set Pending / Approved / Rejected.
- SQLite database stores applications and code hashes.

## Run locally
1. Install Node.js 20 or newer.
2. Open a terminal in this project folder and run `npm install`.
3. Set two private environment variables:
   - `ADMIN_PASSWORD`: your private dashboard password.
   - `SESSION_SECRET`: a long random secret (at least 32 random characters).
4. Start the app with `npm start`.
5. Open `http://localhost:3000` for the application page.
6. Open `http://localhost:3000/admin` for the admin dashboard.
7. Log in, create a different code for each inviter, then privately share each code with the right person.

Example environment setup (macOS/Linux):
```bash
export ADMIN_PASSWORD='use-a-strong-private-password'
export SESSION_SECRET='replace-with-a-long-random-secret'
npm start
```
Windows PowerShell:
```powershell
$env:ADMIN_PASSWORD="use-a-strong-private-password"
$env:SESSION_SECRET="replace-with-a-long-random-secret"
npm start
```

## Deployment
This is a Node.js app, not a static-only GitHub Pages site. Deploy it to a Node.js host that supports persistent storage (for example, Render with a persistent disk). Set `ADMIN_PASSWORD`, `SESSION_SECRET`, `NODE_ENV=production`, and `DB_FILE` in the host's environment settings. Mount persistent storage and point `DB_FILE` to a file on that disk. Enable HTTPS. Do not put secrets in browser JavaScript, GitHub Pages, or this repository.

For production, configure the host's session store rather than Express's default in-memory session store, and review the host's persistent disk / backup settings. The default in-memory session store is suitable only for a starter/demo deployment and may log admins out on restart.

## Important
- Access codes are stored as SHA-256 hashes; the full code is not readable from the database after creation.
- The three initial inviter codes are preloaded as hashes when the database is first created. Codes are reusable until disabled or deleted. The admin can replace or add codes from the dashboard.
- This starter does not send email/Discord notifications to applicants. Applicants see their submitted status message; only admins can currently view and update application status.
- Admin dashboard login is a single-owner password login. Use a unique, strong password and keep it private.


## Initial setup note
The three inviter codes you supplied have been preloaded as hashes in the server code, so their plaintext values are not exposed in the public page. Keep the database private. The admin password is **not** embedded in the project: set `ADMIN_PASSWORD` in your hosting provider's private environment settings. Because the password was shared in chat and is short, choose a new, longer, unique password before putting the site online.

The Twitch field accepts either a channel username (for example `amber_dora`) or a full channel URL; the server normalizes it to the canonical Twitch URL.
