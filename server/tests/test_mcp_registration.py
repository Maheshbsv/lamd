import asyncio

from lamd_server.mcp_app import mcp


def test_tools_are_registered():
    tools = asyncio.run(mcp.list_tools())
    names = {t.name for t in tools}
    assert names == {
        "lamd_search_memory",
        "lamd_save_decision",
        "lamd_save_session",
    }


def test_resources_are_registered():
    resources = asyncio.run(mcp.list_resources())
    resource_uris = {str(r.uri) for r in resources}
    assert resource_uris == {"lamd://rules"}

    templates = asyncio.run(mcp.list_resource_templates())
    template_uris = {t.uri_template for t in templates}
    assert template_uris == {"lamd://rules/{name}"}


def test_lamd_save_decision_description_states_when_to_call_it():
    tools = asyncio.run(mcp.list_tools())
    save_decision = next(t for t in tools if t.name == "lamd_save_decision")
    assert "architectural decision is finalized" in save_decision.description
