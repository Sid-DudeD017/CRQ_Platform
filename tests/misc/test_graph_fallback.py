import sys, os
sys.path.append(os.path.join(os.getcwd(), 'ai-agent'))
import graph
from langchain_core.messages import HumanMessage

state = {"messages": [HumanMessage(content="why is ledger not working or not connected")]}
result = graph.virtual_ciso_supervisor(state)
print("Supervisor result for ledger:", result)

state2 = {"messages": [HumanMessage(content="hello")]}
result2 = graph.virtual_ciso_supervisor(state2)
print("Supervisor result for hello:", result2)

