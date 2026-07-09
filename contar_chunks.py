import json
from pathlib import Path

p = Path(r"D:\Agente Normativas\CORPUS_RAG\CHUNKS\chunks.jsonl")

total = 0
ids = set()
duplicados = 0

with p.open("r", encoding="utf-8") as f:
    for line in f:
        if not line.strip():
            continue

        total += 1
        obj = json.loads(line)
        cid = obj.get("chunk_id")

        if cid in ids:
            duplicados += 1
        else:
            ids.add(cid)

print("Lineas totales:", total)
print("Chunk IDs unicos:", len(ids))
print("Duplicados:", duplicados)