from typing import Annotated, Sequence, TypedDict, Literal
import operator
import os

from dotenv import load_dotenv
# Load environment variables from multiple possible locations to make configuration easier
base_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(base_dir)

load_dotenv(os.path.join(base_dir, ".env"))            # ai-agent/.env
load_dotenv(os.path.join(project_root, "backend", ".env")) # backend/.env
load_dotenv(os.path.join(project_root, ".env"))        # root .env

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

try:
    from langchain_groq import ChatGroq
except ImportError:
    ChatGroq = None

# Import local tools and RAG
from tools import optimize_budget, run_monte_carlo_var, query_telemetry
from rag import search_compliance_frameworks

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next_agent: str

# Prefer Groq (fast, free tier) if a key is set, fall back to OpenAI if
# that's what's configured instead. Either way `llm` stays None (and the
# graph falls back to keyword-based routing / canned responses) if neither
# key is present.
llm = None
if os.environ.get("GROQ_API_KEY") and ChatGroq:
    llm = ChatGroq(model="openai/gpt-oss-20b", temperature=0)
elif os.environ.get("OPENAI_API_KEY"):
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

# Create Sub-Agents using create_react_agent
security_agent = None
compliance_agent = None
quant_agent = None

if llm:
    security_agent = create_react_agent(
        llm, 
        tools=[query_telemetry],
        prompt="You are a Security Analyst. Query telemetry and EDR logs to answer network topology and risk questions."
    )
    
    compliance_agent = create_react_agent(
        llm,
        tools=[search_compliance_frameworks],
        prompt="You are a Compliance Officer. Use RAG to answer queries about RBI, SEBI, NIST, and DPDP frameworks."
    )
    
    quant_agent = create_react_agent(
        llm,
        tools=[optimize_budget, run_monte_carlo_var],
        prompt="You are a Quant Analyst. Run budget optimization and VaR monte carlo simulations."
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

def _general_chat_reply(last_message: str):
    """
    Used when the supervisor decides this isn't a specialist question
    (compliance / budget / telemetry). Previously this just returned a
    single hardcoded sentence for literally every such message - "tell me
    about this webpage" and "what can you do" got the exact same canned
    reply, which is why the assistant felt useless for anything but the
    three specialist topics. Now it actually asks the LLM to answer
    directly, same as a normal chatbot would.
    """
    if not llm:
        last_msg = last_message.lower()
        if "ledger" in last_msg or "blockchain" in last_msg:
            return "The Zero-Trust Blockchain Ledger is currently operating in local mock mode. Please ensure your Hardhat EVM is running and connected to accept real risk transactions on-chain."
        elif "redundant" in last_msg or "repeat" in last_msg or "llm" in last_msg or "key" in last_msg:
            return "I am currently running in offline fallback mode because no LLM API key is configured. Please add an OPENAI_API_KEY or GROQ_API_KEY to ai-agent/.env for full dynamic conversations."
        return "I am the Virtual CISO. (Offline Mode: No LLM API Key configured). I can help you query telemetry, optimize budgets, or check compliance frameworks. How can I assist you today?"
        
    try:
        general_prompt = ChatPromptTemplate.from_messages([
            ("system",
             "You are the Virtual CISO for a Cyber Risk Quantification (CRQ) platform. "
             "Answer the user's question directly and conversationally in 2-4 sentences. "
             "You can go deep on network telemetry/EDR status, RBI/SEBI/NIST/DPDP compliance, "
             "or budget optimization/FAIR Monte Carlo risk simulation if the user asks about "
             "those - but for anything else (small talk, general questions, questions about "
             "this dashboard itself), just answer normally and helpfully like any assistant would."),
            ("user", "{input}"),
        ])
        reply = (general_prompt | llm).invoke({"input": last_message})
        return reply.content
    except Exception as e:
        print(f"General chat LLM call failed: {e}")
        return None


def virtual_ciso_supervisor(state: AgentState):
    messages = state.get("messages", [])
    if not messages:
        return {"next_agent": "FINISH"}

    last_message = messages[-1].content
    route_decision = "FINISH"

    if llm:
        try:
            structured_llm = llm.with_structured_output(Route)
            system_prompt = (
                "You are a Virtual CISO Supervisor. Route the user's request to the correct sub-agent:\n"
                "- security_analyst: for network telemetry, EDR logs, active vulnerabilities.\n"
                "- compliance_officer: for RBI, SEBI, NIST, DPDP regulations and frameworks.\n"
                "- quant_analyst: for budget optimization, VaR, FAIR Monte Carlo modeling.\n"
                "- FINISH: if the user is just chatting, asking something general, or the task is complete."
            )
            prompt = ChatPromptTemplate.from_messages([
                ("system", system_prompt),
                ("user", "{input}")
            ])
            chain = prompt | structured_llm
            result = chain.invoke({"input": last_message})
            route_decision = result.next_agent
        except Exception as e:
            print(f"LLM routing failed: {e}")
            last_message_lower = last_message.lower()
            if any(k in last_message_lower for k in ["compliance", "rbi", "sebi", "nist", "dpdp"]):
                route_decision = "compliance_officer"
            elif any(k in last_message_lower for k in ["budget", "optimize", "var", "monte carlo"]):
                route_decision = "quant_analyst"
            elif any(k in last_message_lower for k in ["telemetry", "vulnerability", "edr"]):
                route_decision = "security_analyst"
    else:
        last_message_lower = last_message.lower()
        if any(k in last_message_lower for k in ["compliance", "rbi", "sebi", "nist", "dpdp"]):
            route_decision = "compliance_officer"
        elif any(k in last_message_lower for k in ["budget", "optimize", "var", "monte carlo"]):
            route_decision = "quant_analyst"
        elif any(k in last_message_lower for k in ["telemetry", "vulnerability", "edr"]):
            route_decision = "security_analyst"

    if route_decision != "FINISH":
        return {"next_agent": route_decision}

    reply_text = _general_chat_reply(last_message)
    if reply_text:
        return {"messages": [AIMessage(content=reply_text)], "next_agent": "FINISH"}
    return {"next_agent": "FINISH"}

def build_multi_agent_graph():
    workflow = StateGraph(AgentState)
    
    workflow.add_node("supervisor", virtual_ciso_supervisor)
    workflow.add_node("security_analyst", security_analyst_node)
    workflow.add_node("compliance_officer", compliance_officer_node)
    workflow.add_node("quant_analyst", quant_analyst_node)
    
    # Each specialist answers once and ends the turn, rather than looping
    # back through the supervisor - a sub-agent's own answer almost always
    # contains its own trigger keywords (e.g. the compliance officer's
    # answer mentions "compliance"), which caused the old routing to send
    # it right back to itself forever until LangGraph's recursion limit
    # killed the request. This was masked before because `llm` was always
    # None (no API key configured), which took a different, shorter path.
    workflow.add_edge("security_analyst", END)
    workflow.add_edge("compliance_officer", END)
    workflow.add_edge("quant_analyst", END)
    
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
