"""langchain-mcp-adapters (MultiServerMCPClient) with no LLM call: only get_tools and a tool invoke.
The streamable_http connection accepts an `auth` httpx.Auth (langchain_mcp_adapters/sessions.py,
StreamableHttpConnection.auth), so the official SDK's OAuthClientProvider drives the whole flow.
The adapter opens a fresh MCP session per tool call. VARIANT: dcr | cimd | cimdforced.
"""

import asyncio

from compat_common import CTX, Recorder, build_provider, run_flow, version

rec = Recorder("langchain-mcp-adapters", {"langchain-mcp-adapters": version("langchain-mcp-adapters"), "mcp": version("mcp")})
provider, milestones = build_provider(CTX["mcpUrl"])


def session_factory():
    from langchain_mcp_adapters.client import MultiServerMCPClient

    client = MultiServerMCPClient(
        {"everything": {"transport": "streamable_http", "url": CTX["mcpUrl"], "auth": provider, "timeout": 30}}
    )

    class Wrapper:
        async def __aenter__(self):
            return client

        async def __aexit__(self, *exc):
            return None

    return Wrapper()


async def list_tools(client):
    return [t.name for t in await client.get_tools()]


async def call_tool(client, message):
    tools = await client.get_tools()
    tool = next(t for t in tools if t.name.endswith("echo"))
    result = await tool.ainvoke({"message": message})
    return result if isinstance(result, str) else str(result)


async def main():
    await run_flow(rec, milestones, session_factory, list_tools, call_tool)
    rec.emit()


asyncio.run(main())
