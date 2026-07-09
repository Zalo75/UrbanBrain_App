import os
from dotenv import load_dotenv
from google import genai
from supabase import create_client
from openai import OpenAI

load_dotenv(".env")

GEMINI_MODEL = "gemini-embedding-001"
EMBED_DIM = 768

pregunta = "¿Cuál es la ocupación máxima en Oza-Cesuras?"
municipio = "Oza"

gemini = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

supabase = create_client(
    os.getenv("NEXT_PUBLIC_SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
)

deepseek = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)

emb = gemini.models.embed_content(
    model=GEMINI_MODEL,
    contents=pregunta,
    config={
        "task_type": "RETRIEVAL_QUERY",
        "output_dimensionality": EMBED_DIM,
    },
).embeddings[0].values

matches = supabase.rpc(
    "match_normativa_chunks",
    {
        "query_embedding": emb,
        "match_count": 8,
        "filter_municipio": municipio,
    },
).execute()

chunks = matches.data or []

print(f"\nChunks encontrados: {len(chunks)}\n")

for i, c in enumerate(chunks, 1):
    print("=" * 80)
    print(f"{i}. {c.get('municipio_nombre')} | {c.get('nombre_pdf')}")
    print(f"Similarity: {c.get('similarity')}")
    print((c.get("texto") or "")[:700])

contexto = "\n\n".join(
    [
        f"[Fuente {i}] Municipio: {c.get('municipio_nombre')}\nDocumento: {c.get('nombre_pdf')}\nTexto:\n{c.get('texto')}"
        for i, c in enumerate(chunks, 1)
    ]
)

response = deepseek.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {
            "role": "system",
            "content": (
                "Eres UrbanBrain, asistente urbanístico. "
                "Responde solo con la información del contexto. "
                "Si no hay información suficiente, dilo claramente. "
                "Cita las fuentes usadas como [Fuente 1], [Fuente 2], etc."
            ),
        },
        {
            "role": "user",
            "content": f"Contexto:\n{contexto}\n\nPregunta:\n{pregunta}",
        },
    ],
)

print("\n\n===== RESPUESTA URBANBRAIN =====\n")
print(response.choices[0].message.content)