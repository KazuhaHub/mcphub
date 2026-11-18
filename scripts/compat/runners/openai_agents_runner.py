"""OpenAI Agents SDK (openai-agents) MCPServerStreamableHttp, with no LLM call: only list_tools and
call_tool. The server params accept an `auth` httpx.Auth handler (agents/mcp/server.py,
MCPServerStreamableHttpParams.auth), so the official SDK's OAuthClientProvider drives the whole flow.
VARIANT: dcr | cimd | cimdforced.
"""

import asyncio

from compat_common import CTX, Recorder, build_provider, run_flow, version

rec = Recorder("openai-agents", {"openai-agents": version("openai-agents"), "mcp": version("mcp")})
provider, milestones = build_provider(CTX["mcpUrl"])


def session_factory():
    from agents.mcp import MCPServerStreamableHttp

    server = MCPServerStreamableHttp(
        params={"url": CTX["mcpUrl"], "auth": provider, "timeout": 30},
        cache_tools_list=False,
        client_session_timeout_seconds=30,
    )

    class Wrapper:
        async def __aenter__(self):
            await server.connect()
            return server

        async def __aexit__(self, *exc):
            await server.cleanup()

    return Wrapper()


async def list_tools(server):
    return [t.name for t in await server.list_tools()]


async def call_tool(server, message):
    name = next(n for n in await list_tools(server) if n.endswith("echo"))
    result = await server.call_tool(name, {"message": message})
    text = " ".join(getattr(c, "text", "") for c in result.content)
    if getattr(result, "isError", False) or getattr(result, "is_error", False):
        raise RuntimeError(f"tool returned an error result: {text[:200]}")
    return text


async def main():
    await run_flow(rec, milestones, session_factory, list_tools, call_tool)
    rec.emit()


asyncio.run(main())
