"""Official Python SDK (mcp) streamable-http client with its OAuthClientProvider.

OpenAI Agents SDK (MCPServerStreamableHttp) and langchain-mcp-adapters sit on this OAuth machinery.
Works against both SDK lines: mcp 1.x (httpx, ClientSession) and mcp 2.x (httpx2, Client with
version negotiation). VARIANT: dcr | cimd | cimdforced.
"""

import asyncio

from compat_common import CTX, Recorder, build_provider, run_flow, version

MODERN = int(version("mcp").split(".")[0]) >= 2
rec = Recorder("py-sdk", {"mcp": version("mcp"), "httpx2" if MODERN else "httpx": version("httpx2" if MODERN else "httpx")})
provider, milestones = build_provider(CTX["mcpUrl"])


def text_of(result) -> str:
    text = " ".join(getattr(c, "text", "") for c in result.content)
    if getattr(result, "isError", False) or getattr(result, "is_error", False):
        raise RuntimeError(f"tool returned an error result: {text[:200]}")
    return text


if MODERN:
    import httpx2
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client

    def session_factory():
        http_client = httpx2.AsyncClient(auth=provider, follow_redirects=False)
        client = Client(streamable_http_client(CTX["mcpUrl"], http_client=http_client), mode="auto")

        class Wrapper:
            async def __aenter__(self):
                await client.__aenter__()
                rec.result["protocol"] = {"negotiated": client.protocol_version, "era": None}
                return client

            async def __aexit__(self, *exc):
                return await client.__aexit__(*exc)

        return Wrapper()

    async def list_tools(session):
        return [t.name for t in (await session.list_tools()).tools]

    async def call_tool(session, message):
        result = await session.call_tool(next(n for n in await list_tools(session) if n.endswith("echo")), {"message": message})
        return text_of(result)

else:
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    def session_factory():
        http_client = httpx.AsyncClient(auth=provider, follow_redirects=False)

        class Wrapper:
            async def __aenter__(self):
                self.transport = streamable_http_client(CTX["mcpUrl"], http_client=http_client)
                read, write, _ = await self.transport.__aenter__()
                self.session = ClientSession(read, write)
                await self.session.__aenter__()
                init = await self.session.initialize()
                rec.result["protocol"] = {"negotiated": init.protocolVersion, "era": "legacy"}
                return self.session

            async def __aexit__(self, *exc):
                await self.session.__aexit__(*exc)
                return await self.transport.__aexit__(*exc)

        return Wrapper()

    async def list_tools(session):
        return [t.name for t in (await session.list_tools()).tools]

    async def call_tool(session, message):
        result = await session.call_tool(next(n for n in await list_tools(session) if n.endswith("echo")), {"message": message})
        return text_of(result)


async def main():
    await run_flow(rec, milestones, session_factory, list_tools, call_tool)
    rec.emit()


asyncio.run(main())
