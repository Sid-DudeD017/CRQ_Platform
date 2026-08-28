import asyncio
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableLambda

def sync_node(state):
    # This is a synchronous node
    print("Inside sync_node")
    return {"messages": []}

workflow = StateGraph(dict)
workflow.add_node("sync", sync_node)
workflow.add_edge(START, "sync")
workflow.add_edge("sync", END)
app = workflow.compile()

async def main():
    async for event in app.astream_events({"messages": []}, version="v1"):
        print(event["event"], event["name"])

asyncio.run(main())
