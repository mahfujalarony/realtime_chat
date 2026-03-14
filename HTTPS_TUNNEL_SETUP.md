# HTTPS Dev Test (WhatsApp-like Call Permission)

Use this to test mobile call permission in dev exactly like production HTTPS.

## 1) Install ngrok (Windows)

```powershell
winget install Ngrok.Ngrok
```

Then login at ngrok dashboard, copy your auth token, and run:

```powershell
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

## 2) Start your local servers

Open 3 terminals:

```powershell
# Terminal 1
cd chatbackend
npm run dev
```

```powershell
# Terminal 2
cd upload
npm start
```

```powershell
# Terminal 3
cd chatfrontend
npm run dev
```

## 3) Start 3 HTTPS tunnels

Open 3 more terminals:

```powershell
ngrok http 5173 --host-header=rewrite
```

```powershell
ngrok http 5000
```

```powershell
ngrok http 5001
```

Copy the 3 HTTPS URLs:
- frontend URL (for 5173)
- backend URL (for 5000)
- upload URL (for 5001)

## 4) Update env files

### `chatfrontend/.env`

```env
VITE_API_URL=https://YOUR_BACKEND_URL.ngrok-free.app
VITE_SOCKET_URL=https://YOUR_BACKEND_URL.ngrok-free.app
VITE_UPLOAD_SERVER_URL=https://YOUR_UPLOAD_URL.ngrok-free.app
```

### `chatbackend/.env`

Set:

```env
CORS_ORIGIN=https://YOUR_FRONTEND_URL.ngrok-free.app,http://localhost:5173,http://192.168.0.100:5173
APP_PUBLIC_URL=https://YOUR_FRONTEND_URL.ngrok-free.app
```

## 5) Restart backend + frontend + upload

After env changes, restart all 3 local servers.

## 6) Test on mobile

Open the **frontend HTTPS ngrok URL** on phone and login.
Now call flow should show browser/system camera/mic permission prompt properly.

## Notes

- If camera/mic was blocked before, clear site permission once and retry.
- HTTPS page cannot call HTTP API, so backend/upload must also be HTTPS (tunneled).
- Keep ngrok terminals running while testing.

