from typing import Annotated, Sequence, TypedDict, Literal
import operator
import os
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

# Import local tools and RAG
from tools import optimize_budget, run_monte_carlo_var, query_telemetry
from rag import search_compliance_frameworks

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next_agent: str

llm = None
if os.environ.get("OPENAI_API_KEY"):
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

# Create Sub-Agents using create_react_agent
security_agent = None
compliance_agent = None
quant_agent = None

if llm:
    security_agent = create_react_agent(
        llm, 
        tools=[query_telemetry],
        state_modifier="You are a Security Analyst. Query telemetry and EDR logs to answer network topology and risk questions."
    )
    
    compliance_agent = create_react_agent(
        llm,
        tools=[search_compliance_frameworks],
        state_modifier="You are a Compliance Officer. Use RAG to answer queries about RBI, SEBI, NIST, and DPDP frameworks."
    )
    
    quant_agent = create_react_agent(
        llm,
        tools=[optimize_budget, run_monte_carlo_var],
        state_modifier="You are a Quant Analyst. Run budget optimization and VaR monte carlo simulations."
    )

def security_analyst_node(state: AgentState):
    if security_agent:
        result = security_agent.invoke({"messages": state["messages"]})
        return {"messages": [AIMessage(content=f"[Security Analyst] {result['messages'][-1].content}")], "next_agent": "supervisor"}
    return {"messages": [AIMessage(content="[Security Analyst] LLM not configured.")], "next_agent": "supervisor"}

def compliance_officer_node(state: AgentState):
    if compliance_agent:
        result = compliance_agent.invoke({"messages": state["messages"]})
        return {"messages": [AIMessage(content=f"[Compliance Officer] {result['messages'][-1].content}")], "next_agent": "supervisor"}
    return {"messages": [AIMessage(content="[Compliance Officer] LLM not configured.")], "next_agent": "supervisor"}

def quant_analyst_node(state: AgentState):
    if quant_agent:
        result = quant_agent.invoke({"messages": state["messages"]})
        return {"messages": [AIMessage(content=f"[Quant Analyst] {result['messages'][-1].content}")], "next_agent": "supervisor"}
    return {"messages": [AIMessage(content="[Quant Analyst] LLM not configured.")], "next_agent": "supervisor"}

class Route(BaseModel):
    next_agent: Literal["security_analyst", "compliance_officer", "quant_analyst", "FINISH"] = Field(...)

def virtual_ciso_supervisor(state: AgentState):
    messages = state.get("messages", [])
    if not messages:
        return {"next_agent": "FINISH"}
        
    last_message = messages[-1].content
    
    if llm:
        try:
            structured_llm = llm.with_structured_output(Route)
            system_prompt = (
                "You are a Virtual CISO Supervisor. Route the user's request to the correct sub-agent:\n"
                "- security_analyst: for network telemetry, EDR logs, active vulnerabilities.\n"
                "- compliance_officer: for RBI, SEBI, NIST, DPDP regulations and frameworks.\n"
                "- quant_analyst: for budget optimization, VaR, FAIR Monte Carlo modeling.\n"
                "- FINISH: if the user is just chatting or the task is complete."
            )
            prompt = ChatPromptTemplate.from_messages([
                ("system", system_prompt),
                ("user", "{input}")
            ])
            chain = prompt | structured_llm
            result = chain.invoke({"input": last_message})
            return {"next_agent": result.next_agent}
        except Exception as e:
            print(f"LLM routing failed: {e}")
            pass
            
    # Fallback routing
    last_message_lower = last_message.lower()
    if any(k in last_message_lower for k in ["compliance", "rbi", "sebi", "nist", "dpdp"]):
        return {"next_agent": "compliance_officer"}
    elif any(k in last_message_lower for k in ["budget", "optimize", "var", "monte carlo"]):
        return {"next_agent": "quant_analyst"}
    elif any(k in last_message_lower for k in ["telemetry", "vulnerability", "edr"]):
        return {"next_agent": "security_analyst"}
    else:
        return {"next_agent": "FINISH"}

def build_multi_agent_graph():
    workflow = StateGraph(AgentState)
    
    workflow.add_node("supervisor", virtual_ciso_supervisor)
    workflow.add_node("security_analyst", security_analyst_node)
    workflow.add_node("compliance_officer", compliance_officer_node)
    workflow.add_node("quant_analyst", quant_analyst_node)
    
    workflow.add_edge("security_analyst", "supervisor")
    workflow.add_edge("compliance_officer", "supervisor")
    workflow.add_edge("quant_analyst", "supervisor")
    
    workflow.add_conditional_edges(
        "supervisor",
        lambda x: x["next_agent"],
        {
            "security_analyst": "security_analyst",
            "compliance_officer": "compliance_officer",
            "quant_analyst": "quant_analyst",
            "FINISH": END
        }
    )
    
    workflow.add_edge(START, "supervisor")
    return workflow.compile()

app = build_multi_agent_graph()
