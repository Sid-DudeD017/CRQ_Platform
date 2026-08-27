import asyncio
from langchain_core.messages import HumanMessage
import sys, os
sys.path.append('ai-agent')
sys.path.append('backend')
import graph as ai_graph

async def main():
    initial_state = {"messages": [HumanMessage(content="what is my budget")]}
    async for event in ai_graph.app.astream_events(initial_state, version="v1"):
        kind = event["event"]
        if kind == "on_chat_model_stream":
            content = event["data"]["chunk"].content
            if content:
                print("CHUNK:", content)
        elif kind == "on_chain_end":
            if event["name"] in ["security_analyst", "compliance_officer", "quant_analyst"]:
                msgs = event["data"].get("output", {}).get("messages", [])
                if msgs and not os.environ.get("OPENAI_API_KEY"):
                    print("YIELDING:", msgs[-1].content)

asyncio.run(main())
