import os
import chromadb
from langchain_core.tools import tool

# Setup persistent directory for ChromaDB
CHROMA_DATA_DIR = os.path.join(os.path.dirname(__file__), "chroma_data")
chroma_client = chromadb.PersistentClient(path=CHROMA_DATA_DIR)

# Initialize collection for regulatory compliance frameworks
compliance_collection = chroma_client.get_or_create_collection(
    name="compliance_frameworks",
    metadata={"description": "Regulatory frameworks including RBI, SEBI, NIST, and DPDP"}
)

# Populate mock data if empty
if compliance_collection.count() == 0:
    mock_docs = [
        "RBI Cyber Security Framework: Requires banks to maintain isolated network zones, conduct continuous EDR monitoring, and have a response plan for ransomware.",
        "SEBI CSCRF (August 2024): Mandates zero-trust architecture, automated budget optimization for risk mitigation, and continuous vulnerability scanning for brokers.",
        "NIST CSF 2.0: Emphasizes Identify, Protect, Detect, Respond, Recover, and Govern. Focuses heavily on managing supply chain risks and telemetry tracking.",
        "DPDP Act 2023: Requires explicit consent for data processing and strict audit logging on a tamper-proof ledger (like blockchain) for risk acceptances."
    ]
    ids = ["doc1", "doc2", "doc3", "doc4"]
    metadatas = [{"source": "RBI"}, {"source": "SEBI"}, {"source": "NIST"}, {"source": "DPDP"}]
    compliance_collection.add(documents=mock_docs, metadatas=metadatas, ids=ids)

@tool
def search_compliance_frameworks(query: str, n_results: int = 3) -> str:
    """
    Searches the RAG pipeline (ChromaDB) for relevant regulatory and compliance information
    regarding RBI, SEBI, NIST, and DPDP frameworks. Each retrieved passage is tagged with
    which framework it actually came from, so the answer can be traced back to a real
    source document instead of reading as an unverifiable model claim.
    """
    results = compliance_collection.query(
        query_texts=[query],
        n_results=n_results
    )

    if not results or not results.get('documents') or not results['documents'][0]:
        return "No specific compliance guidelines found in the RAG database for this query."

    documents = results['documents'][0]
    metadatas = results.get('metadatas', [[]])[0] or []
    sources = sorted({m.get('source', 'UNKNOWN') for m in metadatas if m})

    tagged_passages = []
    for i, doc in enumerate(documents):
        source = metadatas[i].get('source', 'UNKNOWN') if i < len(metadatas) and metadatas[i] else 'UNKNOWN'
        tagged_passages.append(f"[Source: {source}] {doc}")

    body = "\n\n".join(tagged_passages)
    footer = f"\n\n(Retrieved from: {', '.join(sources)}. Always name the specific framework(s) above when answering, and end your answer with a line like \"Sources: RBI, SEBI\" listing exactly which of these were actually used.)"
    return body + footer
