"""
Axistra Portal — FastAPI proxy.

The Emergent supervisor is locked to launching `uvicorn server:app` on port 8001.
We therefore spawn the real NestJS application as a child process listening on
NEST_PORT (default 9001) and transparently proxy every request reaching uvicorn
to that NestJS instance. The whole platform behaves as a single NestJS service.
"""

import asyncio
import logging
import os
import signal
import subprocess
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [proxy] %(message)s")
log = logging.getLogger("axistra-proxy")

NEST_DIR = "/app/backend-nest"
NEST_PORT = int(os.environ.get("NEST_PORT", "9001"))
NEST_URL = f"http://127.0.0.1:{NEST_PORT}"

nest_proc: subprocess.Popen | None = None


async def wait_for_nest_ready(timeout: int = 60) -> bool:
    deadline = asyncio.get_event_loop().time() + timeout
    async with httpx.AsyncClient(timeout=2.0) as client:
        while asyncio.get_event_loop().time() < deadline:
            try:
                r = await client.get(f"{NEST_URL}/api/health")
                if r.status_code == 200:
                    log.info("NestJS is ready.")
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
    return False


def ensure_postgres():
    """Make sure PostgreSQL is running. Idempotent."""
    try:
        subprocess.run(
            ["pg_isready", "-h", "127.0.0.1", "-p", "5432"],
            check=True, capture_output=True, timeout=5,
        )
        log.info("PostgreSQL is already running.")
    except Exception:
        log.info("Starting PostgreSQL ...")
        try:
            subprocess.run(["service", "postgresql", "start"], capture_output=True, timeout=30)
        except Exception as e:
            log.error("Failed to start PostgreSQL: %s", e)


def start_nest():
    global nest_proc
    ensure_postgres()
    log.info("Starting NestJS child process on port %s ...", NEST_PORT)
    env = os.environ.copy()
    env["PORT"] = str(NEST_PORT)
    nest_proc = subprocess.Popen(
        ["node", "dist/main.js"],
        cwd=NEST_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
    )


def stop_nest():
    global nest_proc
    if nest_proc and nest_proc.poll() is None:
        log.info("Terminating NestJS child process ...")
        try:
            os.killpg(os.getpgid(nest_proc.pid), signal.SIGTERM)
            nest_proc.wait(timeout=10)
        except Exception:
            try:
                os.killpg(os.getpgid(nest_proc.pid), signal.SIGKILL)
            except Exception:
                pass
    nest_proc = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_nest()
    ok = await wait_for_nest_ready()
    if not ok:
        log.error("NestJS did not become ready in time. Requests will return 503.")
    yield
    stop_nest()


app = FastAPI(lifespan=lifespan, title="Axistra Compliance Portal (NestJS-proxied)")

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-encoding",
    "host",
}


@app.get("/")
async def root():
    return {"service": "Axistra Compliance + Accounting Portal", "engine": "NestJS via FastAPI proxy"}


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy(path: str, request: Request):
    body = await request.body()
    url = f"{NEST_URL}/api/{path}"
    query = str(request.url.query)
    if query:
        url = f"{url}?{query}"

    fwd_headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
    fwd_headers.setdefault("x-forwarded-for", request.client.host if request.client else "")

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.request(
                request.method, url, headers=fwd_headers, content=body
            )
    except httpx.ConnectError:
        return Response(status_code=503, content="NestJS backend unreachable")

    resp_headers = {k: v for k, v in r.headers.items() if k.lower() not in HOP_BY_HOP}
    return Response(content=r.content, status_code=r.status_code, headers=resp_headers, media_type=r.headers.get("content-type"))
