




# ============================================================
#  AI JUDGE FINAL BACKEND (Stable + Fact-Anchored + Inference Mode)
# ============================================================

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict
import os, io, json, uuid, re, requests, redis
import PyPDF2, docx
from dotenv import load_dotenv

# ------------------------------------------------------------
# Load ENV
# ------------------------------------------------------------
load_dotenv()

app = FastAPI(title="AI Judge FINAL Backend", version="8.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ------------------------------------------------------------
# Redis (Optional)
# ------------------------------------------------------------
try:
    redis_client = redis.Redis(host="localhost", port=6379, decode_responses=True)
    redis_client.ping()
except:
    redis_client = None

_memory_cases = {}
_memory_args = {}

# ------------------------------------------------------------
# Gemini API setup
# ------------------------------------------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = "models/gemini-flash-latest"

if GEMINI_API_KEY:
    GEMINI_ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
else:
    GEMINI_ENDPOINT = None

# ------------------------------------------------------------
# Data Models
# ------------------------------------------------------------
class CaseData(BaseModel):
    plaintiff_docs: List[str]
    defendant_docs: List[str]
    jurisdiction: str
    case_category: str

class ArgumentModel(BaseModel):
    side: str
    argument_text: str
    documents: List[str] = []

class VerdictRequest(BaseModel):
    case_data: CaseData
    previous_arguments: List[ArgumentModel]

class SubmitArgumentPayload(BaseModel):
    argument: ArgumentModel
    case_id: str

# ------------------------------------------------------------
# Extractors
# ------------------------------------------------------------
def extract_pdf(content: bytes):
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(content))
        return "\n".join([p.extract_text() or "" for p in reader.pages])
    except:
        return "[PDF extraction error]"

def extract_docx(content: bytes):
    try:
        doc = docx.Document(io.BytesIO(content))
        return "\n".join([p.text for p in doc.paragraphs])
    except:
        return "[DOCX extraction error]"

async def extract_text_from_file(file: UploadFile):
    data = await file.read()
    name = file.filename.lower()

    if name.endswith(".pdf"):
        return extract_pdf(data)
    if name.endswith(".doc") or name.endswith(".docx"):
        return extract_docx(data)

    try:
        return data.decode("utf-8")
    except:
        return data.decode("utf-8", errors="ignore")

# ------------------------------------------------------------
# JSON extractor
# ------------------------------------------------------------
def extract_json(text: str):
    try:
        return json.loads(text)
    except:
        pass

    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group())
        except:
            pass

    cleaned = text.replace("'", '"')
    try:
        return json.loads(cleaned)
    except:
        return None

# ------------------------------------------------------------
# Prompt Builder (Fact Anchoring + Inference Mode)
# ------------------------------------------------------------
def build_prompt(case: CaseData, arguments: List[Dict]):
    return f"""
You are an AI Supreme Court Judge.

===============================================================
FACT-ANCHORING + INFERENCE RULES:
===============================================================
1. If documents contain explicit facts (names, dates, claims, contract terms, events, payments, etc.):
   → Preserve them EXACTLY as written (no modification).

2. If documents lack sufficient detail, contain only generic statements,
   or do not provide a complete factual background:
   → You MUST infer a logical and realistic factual scenario.
   → DO NOT dismiss the case.
   → ALWAYS render a full, reasoned judgment.

3. NEVER say:
   - "insufficient information"
   - "cannot decide"
   - "no evidence"
   - "dismissed for lack of evidence"

4. ALWAYS create:
   ✔ Full case facts  
   ✔ Legal reasoning  
   ✔ Key evidence  
   ✔ Precedents  
   ✔ Next arguments for both sides  
   ✔ A clear winner  

===============================================================
STRICT JSON RESPONSE FORMAT:
===============================================================
{{
  "verdict": "",
  "reasoning": "",
  "confidence": "",
  "key_evidence": {{
      "plaintiff": [],
      "defendant": []
  }},
  "precedents": [],
  "counterarguments": [],
  "suggested_next_arguments": {{
      "plaintiff": "",
      "defendant": ""
  }}
}}

===============================================================
CASE DOCUMENTS (USE FACTS IF PRESENT):
===============================================================
PLAINTIFF DOCUMENTS:
{json.dumps(case.plaintiff_docs, indent=2)}

DEFENDANT DOCUMENTS:
{json.dumps(case.defendant_docs, indent=2)}

PREVIOUS ARGUMENTS:
{json.dumps(arguments, indent=2)}

===============================================================
Now issue a FINAL judgment by:
- Preserving any provided facts
- Inferring missing facts when necessary
- Resolving the dispute completely
===============================================================
""".strip()

# ------------------------------------------------------------
# Gemini Caller (Stable Output)
# ------------------------------------------------------------
def call_gemini(prompt: str):
    if not GEMINI_ENDPOINT:
        return json.dumps({
            "verdict": "Plaintiff partly succeeds.",
            "reasoning": "Mock mode – API key missing.",
            "confidence": "medium",
            "key_evidence": {"plaintiff": [], "defendant": []},
            "precedents": [],
            "counterarguments": [],
            "suggested_next_arguments": {"plaintiff": "", "defendant": ""}
        })

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.85
        }
    }

    try:
        r = requests.post(GEMINI_ENDPOINT, json=payload, headers={"Content-Type":"application/json"}, timeout=30)
        r.raise_for_status()
        data = r.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        return json.dumps({
            "verdict": "Fallback Verdict",
            "reasoning": f"Gemini error: {str(e)}",
            "confidence": "low",
            "key_evidence": {"plaintiff": [], "defendant": []},
            "precedents": [],
            "counterarguments": [],
            "suggested_next_arguments": {"plaintiff": "", "defendant": ""}
        })

# ------------------------------------------------------------
# Case Storage
# ------------------------------------------------------------
def save_case(cid, data):
    if redis_client:
        redis_client.setex(cid, 3600, json.dumps(data))
    else:
        _memory_cases[cid] = data

def load_case(cid):
    if redis_client:
        raw = redis_client.get(cid)
        return json.loads(raw) if raw else None
    return _memory_cases.get(cid)

def save_args(cid, args):
    if redis_client:
        redis_client.setex(cid + "_args", 3600, json.dumps(args))
    else:
        _memory_args[cid] = args

def load_args(cid):
    if redis_client:
        raw = redis_client.get(cid + "_args")
        return json.loads(raw) if raw else []
    return _memory_args.get(cid, [])

# ------------------------------------------------------------
# UPLOAD DOCUMENTS (Supports camelCase + snake_case)
# ------------------------------------------------------------
@app.post("/api/upload-documents")
async def upload_documents(
    plaintiffFiles: List[UploadFile] = File(default=[]),
    defendantFiles: List[UploadFile] = File(default=[]),
    plaintiff_files: List[UploadFile] = File(default=[]),
    defendant_files: List[UploadFile] = File(default=[]),
    jurisdiction: str = "Supreme Court",
    case_category: str = "Civil"
):
    merged_plaintiff = (plaintiffFiles or []) + (plaintiff_files or [])
    merged_defendant = (defendantFiles or []) + (defendant_files or [])

    p_texts, d_texts = [], []

    for f in merged_plaintiff:
        txt = await extract_text_from_file(f)
        p_texts.append(txt[:2000])

    for f in merged_defendant:
        txt = await extract_text_from_file(f)
        d_texts.append(txt[:2000])

    if len(merged_plaintiff) == 0 and len(merged_defendant) == 0:
        return {"success": False, "error": "No files uploaded."}

    case_id = f"case_{uuid.uuid4().hex[:8]}"

    save_case(case_id, {
        "plaintiff_docs": p_texts,
        "defendant_docs": d_texts,
        "jurisdiction": jurisdiction,
        "case_category": case_category
    })

    save_args(case_id, [])

    return {
        "success": True,
        "case_id": case_id,
        "plaintiff_file_count": len(merged_plaintiff),
        "defendant_file_count": len(merged_defendant)
    }

# ------------------------------------------------------------
# GET VERDICT
# ------------------------------------------------------------
@app.post("/api/get-verdict")
async def get_verdict(req: VerdictRequest):
    prompt = build_prompt(req.case_data, [a.dict() for a in req.previous_arguments])
    out = call_gemini(prompt)
    parsed = extract_json(out)

    if not parsed:
        parsed = {
            "verdict": "Fallback Verdict",
            "reasoning": out,
            "confidence": "low",
            "key_evidence": {"plaintiff": [], "defendant": []},
            "precedents": [],
            "counterarguments": [],
            "suggested_next_arguments": {"plaintiff": "", "defendant": ""}
        }

    return {"success": True, **parsed}

# ------------------------------------------------------------
# SUBMIT ARGUMENT
# ------------------------------------------------------------
MAX_ARGS = 5

@app.post("/api/submit-argument")
async def submit_argument(payload: SubmitArgumentPayload):

    case = load_case(payload.case_id)
    if not case:
        return {"success": False, "error": "Case not found"}

    args = load_args(payload.case_id)
    if len(args) >= MAX_ARGS:
        return {"success": False, "error": f"Only {MAX_ARGS} argument rounds allowed"}

    args.append(payload.argument.dict())
    save_args(payload.case_id, args)

    prompt = build_prompt(CaseData(**case), args)
    out = call_gemini(prompt)
    parsed = extract_json(out)

    if not parsed:
        parsed = {
            "verdict": "Fallback Verdict",
            "reasoning": out,
            "confidence": "low",
            "key_evidence": {"plaintiff": [], "defendant": []},
            "precedents": [],
            "counterarguments": [],
            "suggested_next_arguments": {"plaintiff": "", "defendant": ""}
        }

    return {"success": True, **parsed}

# ------------------------------------------------------------
# Case Status
# ------------------------------------------------------------
@app.get("/api/case-status/{cid}")
def case_status(cid):
    return {"success": True, "arguments": len(load_args(cid))}

# ------------------------------------------------------------
# Root endpoint
# ------------------------------------------------------------
@app.get("/")
def home():
    return {"message": "AI Judge Final Backend Running (Fact Anchored + Inference Mode + Stable Output)"}
