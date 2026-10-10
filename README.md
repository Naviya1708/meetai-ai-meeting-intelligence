# MeetAI — Local transcription, summaries, and action items

MeetAI is a Windows-friendly meeting-analysis app that records or uploads an audio file, runs local transcription with Faster-Whisper, saves the transcript to Supabase, and then creates a summary and action items from the actual transcript.

This project does not require OpenAI credits for the main workflow. The app uses a local Python backend for transcription and a free local analysis routine for summaries and action items.

---

## Prerequisites

Before you begin, install:

- Windows 10 or 11
- Python 3.11 or 3.12 (3.13 also works with the provided packages)
- Node.js 18+ and npm
- Git (optional, but helpful)
- FFmpeg for audio conversion and MP3/M4A/WebM support
- A Supabase project with a private `meeting-recordings` bucket and the matching schema in `supabase/migrations`

Recommended setup:

- Use PowerShell as your terminal.
- Prefer a project folder like `C:\Users\YourName\Downloads\MeetAI-recorded-meeting-fixed\project`.

---

## 1) Extract the project zip

1. Extract the project zip to a folder such as:
   `C:\Users\YourName\Downloads\MeetAI-recorded-meeting-fixed\project`
2. Open a PowerShell window in that folder.

Example:

```powershell
cd "C:\Users\YourName\Downloads\MeetAI-recorded-meeting-fixed\project"
Get-ChildItem
```

---

## 2) Create and activate a Python virtual environment

Run these PowerShell commands:

```powershell
cd "C:\Users\YourName\Downloads\MeetAI-recorded-meeting-fixed\project"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python --version
```

If PowerShell blocks script execution, run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

---

## 3) Install Python dependencies

Install the backend packages:

```powershell
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

This installs:

- FastAPI
- Uvicorn
- Faster-Whisper
- python-multipart

The default transcription model is `base`, which is a good balance of speed and accuracy for a typical student laptop. `tiny` is faster but less accurate; `small` is slower but more accurate. We use `base` as the practical default.

---

## 4) Install FFmpeg

FFmpeg is required to decode MP3, M4A, WebM, and similar formats before transcription.

On Windows, install it with either of these methods:

Option A: winget

```powershell
winget install --id Gyan.FFmpeg -e
```

Option B: official installer

- Download the static build from https://www.ffmpeg.org/download.html
- Install it and add the `bin` folder to your PATH

Confirm it is installed:

```powershell
ffmpeg -version
```

---

## 5) Configure Supabase

Create or open your Supabase project, then create the database schema in the `supabase/migrations` folder.

If you use the Supabase CLI, you can apply the project schema with:

```powershell
npx supabase db push
```

If the CLI is not available, run the SQL migrations manually in the Supabase SQL editor in order.

Required values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Create a local `.env` file in the project root from the example:

```powershell
Copy-Item .env.example .env
```

Then edit `.env` and fill in your real project values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
VITE_LOCAL_TRANSCRIPTION_URL=http://localhost:8000
```

Important:

- Do not commit your real `.env` file.
- Do not expose the service-role key in frontend code.
- Keep the storage bucket private; the app uses user-scoped policies in the SQL migrations.

---

## 6) Run the Python backend

Open one PowerShell terminal and start the local transcription service:

```powershell
cd "C:\Users\YourName\Downloads\MeetAI-recorded-meeting-fixed\project"
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
```

The backend should start on:

- http://127.0.0.1:8000

Check health:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing
```

Expected response:

```json
{"status":"ok","service":"MeetAI local transcription service","model":"base","requires_openai":false}
```

The first time you run transcription, Faster-Whisper downloads the model to the local cache under `backend/.models`.

---

## 7) Run the React frontend

Open a second PowerShell terminal:

```powershell
cd "C:\Users\YourName\Downloads\MeetAI-recorded-meeting-fixed\project"
npm install
npm run dev -- --host 0.0.0.0
```

The Vite app should start on:

- http://localhost:5173

Open that URL in your browser.

---

## 8) How to test the app

1. Sign in or create a user in your Supabase app.
2. Open the meeting page.
3. Create a meeting or choose an existing one.
4. Upload a real audio file in one of these accepted formats:
   - MP3
   - WAV
   - M4A
   - MP4
   - WebM
   - OGG
5. The app will:
   - upload the file to the secure `meeting-recordings` bucket
   - save the meeting metadata to Supabase
   - send the file to the local Python transcription backend
   - save the transcript and generated summary/action items
6. Re-open the meeting detail page to inspect:
   - transcript
   - summary
   - decisions
   - action items
   - insights

---

## 9) Troubleshooting

### The backend does not start

Check:

```powershell
python --version
python -m pip install -r backend\requirements.txt
```

### FFmpeg is not found

Check PATH:

```powershell
where ffmpeg
ffmpeg -version
```

If missing, reinstall FFmpeg and restart PowerShell.

### No transcript is returned

This usually means no speech was detected, the file is corrupt, or the file is unsupported. The app will show a clear error instead of inventing output.

### Local transcription hangs on first run

This is usually the model download. Leave it running and wait a few minutes. The model will be cached locally after the first successful download.

### Missing Supabase variables

Check `.env` and confirm both values are filled.

```powershell
Get-Content .env
```

### The browser cannot connect to the backend

Make sure the backend is still running on `http://127.0.0.1:8000` and ensure `VITE_LOCAL_TRANSCRIPTION_URL` matches that port.

---

## 10) Stop and restart services

Stop the backend:

- Press `Ctrl + C` in that PowerShell terminal.

Restart:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
```

Stop the frontend:

- Press `Ctrl + C` in the Vite terminal.

Restart:

```powershell
npm run dev -- --host 0.0.0.0
```

---

## 11) Docker?

Docker is not required for this local workflow. The project is designed to run directly on Windows with Python and Node.js. Docker is optional, not mandatory.

---

## 12) Model trade-offs

The chosen model is `base`.

- `tiny`: fastest, least accurate
- `base`: solid default for student laptops
- `small`: slower but more accurate

The default choice keeps transcription practical without requiring a paid API or GPU.

---

## 13) Project notes

This project intentionally avoids paid transcription for the core flow. The local backend path is the main processing route. The old OpenAI-based Supabase function remains deprecated and is no longer used by the app.

If you want to add optional cloud transcription later, it must be clearly labeled and never silently used as a fake fallback.

---

## 14) Common local commands

```powershell
# Activate venv
.\.venv\Scripts\Activate.ps1

# Start backend
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload

# Start frontend
npm run dev -- --host 0.0.0.0

# Run Python tests
python -m pytest -q

# Run frontend build check
npm run build
```