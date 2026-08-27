import asyncio
from langchain_core.messages import HumanMessage
import sys, os
sys.path.append('ai-agent')
sys.path.append('backend')
import graph as ai_graph

async def main():
    initial_state = {"messages": [HumanMessage(content="what is my budget")]}
    async for event in ai_graph.app.astream_events(initial_state, version="v1"):
        print("Event:", event["event"], "Name:", event["name"])
        if event["event"] == "on_chain_end" and event["name"] in ["security_analyst", "compliance_officer", "quant_analyst"]:
            print("Data:", event["data"])

asyncio.run(main())
