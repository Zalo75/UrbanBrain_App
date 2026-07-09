from dotenv import load_dotenv
import os
from openai import OpenAI

load_dotenv(".env")

client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

contexto = """
Normativa de ejemplo:
- Ocupación máxima: 40%
- Altura máxima: 7 m
- Retranqueo frontal: 5 m
"""

pregunta = "¿Cuál es la ocupación máxima permitida?"

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {
            "role": "system",
            "content": (
                "Eres UrbanBrain, un asistente urbanístico. "
                "Responde únicamente usando el contexto proporcionado. "
                "Si el contexto no contiene la respuesta, indícalo."
            ),
        },
        {
            "role": "user",
            "content": f"Contexto:\n{contexto}\n\nPregunta:\n{pregunta}",
        },
    ],
)

print("\n===== RESPUESTA =====\n")
print(response.choices[0].message.content)
