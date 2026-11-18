"""Shared plumbing for the Python runners: step recording, the browser-agent call, and an
in-memory OAuth provider built on the official Python SDK's OAuthClientProvider (works with the
mcp 1.x line on httpx and the mcp 2.x line on httpx2).

Result protocol: the last stdout line is "@@COMPAT_RESULT@@<json>", read by scripts/compat/run.mjs.
"""

from __future__ import annotations

import asyncio
import importlib.metadata as md
import json
import os
import sys
import urllib.request

CTX = json.loads(os.environ["COMPAT_CTX"])
VARIANT = os.environ.get("COMPAT_VARIANT", "dcr")


def version(dist: str) -> str:
    try:
        return md.version(dist)
    except md.PackageNotFoundError:
        return "not installed"


class Recorder:
    def __init__(self, client: str, versions: dict[str, str]):
        self.result: dict = {
            "client": client,
            "variant": VARIANT,
            "versions": {**versions, "python": sys.version.split()[0]},
            "steps": {},
            "protocol": None,
            "notes": [],
        }
        self.blocked: str | None = None

    async def step(self, name: str, fn):
        if self.blocked:
            self.result["steps"][name] = {"status": "skip", "detail": f'blocked by failed step "{self.blocked}"'}
            return None
        try:
            out = await fn()
            detail = out if isinstance(out, str) else ""
            self.result["steps"][name] = {"status": "pass", "detail": detail}
            return out
        except BaseException as error:  # noqa: BLE001 - every failure is a recorded cell
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise
            self.blocked = name
            self.result["steps"][name] = {"status": "fail", "detail": describe(error)[:600]}
            return None

    def mark(self, name: str, status: str, detail: str) -> None:
        self.result["steps"][name] = {"status": status, "detail": detail}

    def emit(self) -> None:
        sys.stdout.write("\n@@COMPAT_RESULT@@" + json.dumps(self.result) + "\n")
        sys.stdout.flush()


def describe(error: BaseException) -> str:
    """Flatten ExceptionGroups (anyio task groups wrap the real error)."""
    inner = getattr(error, "exceptions", None)
    if inner:
        return " | ".join(describe(e) for e in inner)
    return f"{type(error).__name__}: {error}"


def _post_json(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "x-compat-secret": CTX["browserSecret"]},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"browser agent {error.code}: {error.read().decode()[:300]}") from error


async def browser(authorization_url: str) -> dict:
    return await asyncio.to_thread(_post_json, CTX["browserUrl"], {"authorizationUrl": authorization_url})


class Milestones:
    """What the provider got through, so a failed connect can be attributed to the right step."""

    def __init__(self) -> None:
        self.authorization_url: str | None = None
        self.client_info = None
        self.client_info_via_dcr = False
        self.tokens_saved = 0
        self.observed: dict | None = None
        self.callback_error: str | None = None
        self.access_token: str | None = None


def build_provider(server_url: str):
    """Returns (provider, milestones). VARIANT: dcr | cimd | cimdforced."""
    from mcp.client.auth import OAuthClientProvider
    from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthToken

    try:
        from mcp.shared.auth import AuthorizationCodeResult
    except ImportError:  # mcp 1.x: the callback handler returns a (code, state) tuple
        AuthorizationCodeResult = None  # noqa: N806

    redirect_uri = CTX["cimd"]["redirectUri"] if VARIANT.startswith("cimd") else "http://127.0.0.1:9/callback"
    milestones = Milestones()

    class Storage:
        def __init__(self) -> None:
            self.tokens: OAuthToken | None = None
            self.client_info: OAuthClientInformationFull | None = None
            if VARIANT == "cimdforced":
                # The client_id URL is supplied as pre-registered information, bypassing the SDK's own
                # gate on the server advertising client_id_metadata_document_supported.
                self.client_info = OAuthClientInformationFull(
                    client_id=CTX["cimd"]["clientId"],
                    redirect_uris=[redirect_uri],
                    token_endpoint_auth_method="none",
                )
                milestones.client_info = self.client_info

        async def get_tokens(self):
            return self.tokens

        async def set_tokens(self, tokens):
            self.tokens = tokens
            milestones.tokens_saved += 1
            milestones.access_token = tokens.access_token

        async def get_client_info(self):
            return self.client_info

        async def set_client_info(self, info):
            self.client_info = info
            milestones.client_info = info
            milestones.client_info_via_dcr = True

    holder: dict = {}

    async def redirect_handler(url: str) -> None:
        milestones.authorization_url = url
        try:
            result = await browser(url)
        except Exception as error:  # noqa: BLE001
            milestones.callback_error = describe(error)
            raise
        milestones.observed = result.get("observed")
        holder["redirect"] = result["redirect"]

    async def callback_handler():
        from urllib.parse import parse_qs, urlparse

        query = parse_qs(urlparse(holder["redirect"]).query)
        if "error" in query:
            milestones.callback_error = f"{query['error'][0]} {query.get('error_description', [''])[0]}".strip()
            raise RuntimeError(f"authorization refused: {milestones.callback_error}")
        code = query["code"][0]
        state = query.get("state", [None])[0]
        iss = query.get("iss", [None])[0]
        if AuthorizationCodeResult is not None:
            return AuthorizationCodeResult(code=code, state=state, iss=iss)
        return code, state

    metadata = OAuthClientMetadata(
        client_name="compat-python-" + VARIANT,
        redirect_uris=[redirect_uri],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        token_endpoint_auth_method="none",
    )
    kwargs = {}
    if VARIANT == "cimd":
        kwargs["client_metadata_url"] = CTX["cimd"]["clientId"]
    provider = OAuthClientProvider(
        server_url=server_url,
        client_metadata=metadata,
        storage=Storage(),
        redirect_handler=redirect_handler,
        callback_handler=callback_handler,
        **kwargs,
    )
    return provider, milestones


def verify_echo(text: str, message: str) -> str:
    if message not in text:
        raise RuntimeError(f"unexpected tool result (not the echoed message): {text[:200]}")
    return text


async def run_flow(rec: Recorder, milestones: Milestones, session_factory, list_tools, call_tool):
    """Drive discovery/register/login/list/call/refresh.

    The Python SDK runs the whole OAuth dance inside the first request that gets a 401, so the first
    `list_tools` is where discovery, registration and login all happen; the milestones attribute a
    failure there to the right cell. The call and the post-expiry call are attempted separately so
    a failure of one is not filed under the other.
    """
    wait = CTX["accessTokenLifetime"] + 2
    errors: dict[str, BaseException] = {}
    names: list[str] = []
    first_call: str | None = None
    second_call: str | None = None
    before = after = None
    try:
        async with session_factory() as session:
            try:
                names = await list_tools(session)
            except BaseException as error:  # noqa: BLE001
                errors["list"] = error
            if names:
                try:
                    first_call = verify_echo(await call_tool(session, "hello-1"), "hello-1")
                except BaseException as error:  # noqa: BLE001
                    errors["call"] = error
            if first_call is not None:
                before = milestones.access_token
                await asyncio.sleep(wait)
                try:
                    second_call = verify_echo(await call_tool(session, "hello-2-after-expiry"), "hello-2-after-expiry")
                    after = milestones.access_token
                except BaseException as error:  # noqa: BLE001
                    errors["refresh"] = error
    except BaseException as error:  # noqa: BLE001
        # Failure to open the session (the OAuth dance happens here) or to close it. A close error
        # after a complete flow is not a step failure.
        errors.setdefault("session", error)

    failure = errors.get("session") or errors.get("list")
    steps = rec.result["steps"]

    def fail_rest(blocked: str, later: tuple[str, ...]) -> None:
        for step in later:
            steps[step] = {"status": "skip", "detail": f'blocked by failed step "{blocked}"'}

    if milestones.authorization_url:
        steps["discovery"] = {"status": "pass", "detail": f"reached authorization endpoint {milestones.authorization_url.split('?')[0]}"}
    elif failure is None:
        steps["discovery"] = {"status": "pass", "detail": "no authorization needed"}
    else:
        steps["discovery"] = {"status": "fail", "detail": describe(failure)[:600]}
        fail_rest("discovery", ("register", "login", "list", "call", "refresh"))
        return

    info = milestones.client_info
    if info is None:
        steps["register"] = {"status": "fail", "detail": describe(failure) if failure else "no client_id obtained"}
        fail_rest("register", ("login", "list", "call", "refresh"))
        return
    if VARIANT == "cimd" and info.client_id != CTX["cimd"]["clientId"]:
        steps["register"] = {
            "status": "fail",
            "detail": f"client did not use the CIMD URL as client_id (got {info.client_id}); it falls back to DCR unless the server advertises client_id_metadata_document_supported",
        }
        fail_rest("register", ("login", "list", "call", "refresh"))
        return
    if info.client_id == CTX["cimd"]["clientId"]:
        kind = "CIMD (supplied as pre-registered information)" if VARIANT == "cimdforced" else "CIMD"
    else:
        kind = "DCR" if milestones.client_info_via_dcr else "pre-registered"
    steps["register"] = {"status": "pass", "detail": f"{kind} client_id={info.client_id}"}

    if milestones.tokens_saved == 0:
        steps["login"] = {"status": "fail", "detail": describe(failure) if failure else "no tokens saved"}
        fail_rest("login", ("list", "call", "refresh"))
        return
    o = milestones.observed or {}
    steps["login"] = {
        "status": "pass",
        "detail": f"PKCE={o.get('pkceMethod')} resource={o.get('resource') or 'none'} iss-in-callback={o.get('callbackHasIss')}",
    }

    if not names:
        steps["list"] = {"status": "fail", "detail": describe(failure) if failure else "no tools"}
        fail_rest("list", ("call", "refresh"))
        return
    steps["list"] = {"status": "pass", "detail": f"{len(names)} tool(s): {', '.join(names)}"}
    if first_call is None:
        steps["call"] = {"status": "fail", "detail": describe(errors["call"]) if "call" in errors else "no result"}
        fail_rest("call", ("refresh",))
        return
    steps["call"] = {"status": "pass", "detail": f"result: {first_call}"}
    if second_call is None:
        steps["refresh"] = {"status": "fail", "detail": describe(errors["refresh"]) if "refresh" in errors else "no result"}
        return
    if after == before:
        steps["refresh"] = {"status": "fail", "detail": "call succeeded but the access token was never replaced"}
        return
    steps["refresh"] = {"status": "pass", "detail": f"access token replaced; result: {second_call}"}
