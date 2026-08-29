import sys, os
sys.path.append(os.path.join(os.getcwd(), 'ai-agent'))
import graph
from langchain_core.messages import HumanMessage

print("LLM configured:", graph.llm is not None)

state = {"messages": [HumanMessage(content="why is ledger not working or not connected")]}
result = graph.virtual_ciso_supervisor(state)
print("Supervisor result:", result)
