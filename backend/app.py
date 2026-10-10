import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover - exercised when dependency is not installed.
    WhisperModel = None  # type: ignore[assignment]

SUPPORTED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".webm", ".mov", ".ogg"}
MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024

MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
MODEL_STORAGE_DIR = os.getenv("WHISPER_MODEL_DIR", str(Path(__file__).resolve().parent / ".models"))
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("meetai_backend")

app = FastAPI(title="MeetAI Local Transcription Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_cors_headers_and_logging(request, call_next):
    origin = request.headers.get("origin")
    response = await call_next(request)

    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Requested-With"

    if request.method == "OPTIONS":
        response.status_code = 204

    logger.info("HTTP %s %s origin=%s status=%s", request.method, request.url.path, origin, response.status_code)
    return response


@app.options("/api/transcribe/local")
async def transcribe_local_options() -> Response:
    return Response(status_code=204)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    origin = request.headers.get("origin")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)


@app.exception_handler(Exception)
async def generic_exception_handler(request, exc: Exception):
    logger.exception("Unhandled backend exception for %s %s", request.method, request.url.path)
    origin = request.headers.get("origin")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return JSONResponse(
        status_code=500,
        content={"detail": "Unexpected server error. Check backend logs for details."},
        headers=headers,
    )


_model = None


def validate_audio_file(filename: str, size_bytes: Optional[int] = None) -> Optional[str]:
    if not filename or not filename.strip():
        return "No file was selected."

    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_AUDIO_EXTENSIONS:
        return f"Unsupported file format '.{extension.lstrip('.') or 'unknown'}'. Supported formats: MP3, WAV, M4A, MP4, WebM, OGG, MOV."

    if size_bytes is not None and size_bytes <= 0:
        return "The selected file is empty."

    if size_bytes is not None and size_bytes > MAX_AUDIO_SIZE_BYTES:
        mb = max(1, round(size_bytes / (1024 * 1024)))
        return f"This file is {mb} MB. The maximum supported size is 100 MB."

    return None


def summarize_transcript(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return "No transcript was available for summarization."

    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    sentence_list = [s.strip() for s in sentences if s.strip()]
    if not sentence_list:
        return "No transcript was available for summarization."

    focus = sentence_list[:3]
    if len(focus) == 1:
        return focus[0]

    return " ".join(focus)


def extract_action_items(text: str) -> List[Dict[str, Any]]:
    sentences = re.split(r"(?<=[.!?])\s+", text or "")
    action_items: List[Dict[str, Any]] = []
    for sentence in sentences:
        trimmed = sentence.strip()
        if not trimmed:
            continue
        lower = trimmed.lower()
        verbs = [
            "send", "review", "update", "prepare", "create", "build", "schedule",
            "draft", "submit", "fix", "test", "deploy", "write", "follow up",
            "confirm", "complete", "share", "decide", "plan"
        ]
        if not any(v in lower for v in verbs):
            continue
        owner = "Unassigned"
        if "nina" in lower:
            owner = "Nina"
        elif "alex" in lower:
            owner = "Alex"
        elif "sam" in lower:
            owner = "Sam"
        elif "jordan" in lower:
            owner = "Jordan"

        deadline = ""
        if re.search(r"by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week)", lower):
            deadline = "TBD"

        action_items.append({
            "description": trimmed,
            "owner": owner,
            "deadline": deadline,
            "priority": "medium",
            "status": "pending",
        })

    return action_items[:10]


def _get_model():
    global _model
    if WhisperModel is None:
        raise RuntimeError("faster-whisper is not installed. Run: pip install -r backend/requirements.txt")
    if _model is None:
        _model = WhisperModel(
            model_size_or_path=MODEL_NAME,
            device="cpu",
            compute_type="int8",
            download_root=MODEL_STORAGE_DIR,
            local_files_only=False,
        )
    return _model


def _convert_audio_if_needed(file_path: str, output_path: str) -> str:
    if file_path.lower().endswith(".wav"):
        return file_path

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        msg = "FFmpeg is required for local transcription. Install it with: winget install --id Gyan.FFmpeg -e or add ffmpeg to PATH."
        logger.error(msg)
        raise RuntimeError(msg)

    command = [
        ffmpeg_path,
        "-y",
        "-i",
        file_path,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        output_path,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        details = result.stderr.strip() or "ffmpeg returned an error"
        logger.error("FFmpeg conversion failed for %s: %s", file_path, details)
        raise RuntimeError(f"Audio conversion failed: {details}")
    return output_path


def transcribe_audio_file(file_path: str) -> Dict[str, Any]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    model = _get_model()
    temp_wav = file_path
    if not file_path.lower().endswith(".wav"):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            temp_wav = tmp.name
        temp_wav = _convert_audio_if_needed(file_path, temp_wav)

    segments, info = model.transcribe(temp_wav, beam_size=5, language="en")
    transcript_segments: List[Dict[str, Any]] = []
    transcript_lines: List[str] = []
    for index, segment in enumerate(segments):
        text = (segment.text or "").strip()
        if not text:
            continue
        transcript_lines.append(text)
        transcript_segments.append({
            "speaker": "Speaker",
            "text": text,
            "start": round(float(segment.start or 0), 2),
            "end": round(float(segment.end or 0), 2),
        })

    full_text = " ".join(transcript_lines).strip()
    if not full_text:
        raise ValueError("No speech was detected in the uploaded audio file.")

    return {
        "full_text": full_text,
        "segments": transcript_segments,
        "language": info.language or "en",
    }


class LocalAnalysisPayload(BaseModel):
    transcript: str


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "MeetAI local transcription service",
        "model": MODEL_NAME,
        "requires_openai": False,
    }


@app.post("/api/transcribe/local")
async def transcribe_local(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not file.filename:
        logger.warning("Transcription request rejected because no file name was supplied.")
        raise HTTPException(status_code=400, detail="A file is required.")

    logger.info("Received transcription request for %s (%s bytes)", file.filename, getattr(file, 'size', 'unknown'))
    error = validate_audio_file(file.filename, getattr(file, 'size', None))
    if error:
        logger.warning("Rejected upload %s: %s", file.filename, error)
        raise HTTPException(status_code=400, detail=error)

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=Path(file.filename).suffix or ".wav", delete=False) as tmp:
            uploaded = await file.read()
            tmp.write(uploaded)
            temp_path = tmp.name

        logger.info("Starting local transcription for %s using model=%s", file.filename, MODEL_NAME)
        transcript = transcribe_audio_file(temp_path)
        logger.info("Transcription completed for %s, transcript length=%s", file.filename, len(transcript.get('full_text', '')))
        return transcript
    except ValueError as exc:
        logger.warning("No speech detected for %s: %s", file.filename, str(exc))
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("Runtime error during transcription for %s", file.filename)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - mirrors runtime setup issues
        logger.exception("Unexpected transcription error for %s", file.filename)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/api/analyze/local")
def analyze_local(payload: LocalAnalysisPayload) -> Dict[str, Any]:
    summary = summarize_transcript(payload.transcript)
    return {
        "summary": {
            "quick_summary": summary,
            "detailed_summary": summary,
            "highlights": [summary],
            "key_points": [summary],
            "minutes": f"Meeting summary:\n{summary}",
        },
        "action_items": extract_action_items(payload.transcript),
        "decisions": [],
        "topics": [],
    }
