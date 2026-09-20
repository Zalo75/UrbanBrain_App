#!/usr/bin/env python3
"""
UrbanBrain Local Translation Service (Independent Sidecar).
Provides 100% local, offline, deterministic machine translation with NormativeShield protection.
Uses CTranslate2 with INT8 quantization, SentencePiece / Moses BPE, and LRU model cache.
"""

import os
import sys
import json
import time
import re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from collections import OrderedDict
from typing import Dict, Any, Optional

# Force UTF-8 encoding
if (sys.stdout.encoding or '').lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Import NormativeShield from infrastructure
curr_dir = os.path.dirname(os.path.abspath(__file__))
repo_root = os.path.dirname(curr_dir)
sys.path.insert(0, os.path.join(repo_root, "src", "infrastructure", "translation"))

from normative_shield import NormativeShield

import ctranslate2
from transformers import MarianTokenizer
from sacremoses import MosesTokenizer, MosesDetokenizer
import subword_nmt.apply_bpe as bpe_lib
import sentencepiece as spm

# Determine models directory
MODELS_DIR = os.environ.get("LOCAL_TRANSLATION_MODELS_DIR")
if not MODELS_DIR:
    MODELS_DIR = os.path.join(repo_root, "models", "translation")

MODELS_DIR = os.path.abspath(MODELS_DIR)
if not os.path.isdir(MODELS_DIR):
    raise RuntimeError(
        "Directorio de modelos de traducción no encontrado. "
        "Configure LOCAL_TRANSLATION_MODELS_DIR o instale los modelos en models/translation."
    )

PORT = int(os.environ.get("LOCAL_TRANSLATION_PORT", 5005))
HOST = os.environ.get("LOCAL_TRANSLATION_HOST", "127.0.0.1")
MAX_HOT_MODELS = int(os.environ.get("LOCAL_TRANSLATION_MAX_HOT_MODELS", 3))

MODEL_REGISTRY = {
    ("es", "gl"): {
        "type": "marian",
        "dir_name": "opus-mt-es-gl-ct2-int8",
        "hf_ref": "Helsinki-NLP/opus-mt-es-gl",
        "model_id": "opus-mt-es-gl-v1"
    },
    ("gl", "es"): {
        "type": "nos",
        "dir_name": "nos-mt-gl-es-ct2",
        "hf_ref": "proxectonos/Nos_MT-CT2-gl-es",
        "model_id": "nos-mt-gl-es-ct2-v1"
    },
    ("es", "ca"): {
        "type": "softcatala",
        "dir_name": "translate-spa-cat",
        "hf_ref": "softcatala/translate-spa-cat",
        "model_id": "softcatala-spa-cat-v1"
    },
    ("ca", "es"): {
        "type": "softcatala",
        "dir_name": "translate-cat-spa",
        "hf_ref": "softcatala/translate-cat-spa",
        "model_id": "softcatala-cat-spa-v1"
    },
    ("es", "eu"): {
        "type": "marian",
        "dir_name": "opus-mt-es-eu-ct2-int8",
        "hf_ref": "Helsinki-NLP/opus-mt-es-eu",
        "model_id": "opus-mt-es-eu-v1"
    },
    ("eu", "es"): {
        "type": "marian",
        "dir_name": "opus-mt-eu-es-ct2-int8",
        "hf_ref": "Helsinki-NLP/opus-mt-eu-es",
        "model_id": "opus-mt-eu-es-v1"
    },
    ("es", "en"): {
        "type": "marian",
        "dir_name": "opus-mt-es-en-ct2-int8",
        "hf_ref": "Helsinki-NLP/opus-mt-es-en",
        "model_id": "opus-mt-es-en-v1"
    },
    ("en", "es"): {
        "type": "marian",
        "dir_name": "opus-mt-en-es-ct2-int8",
        "hf_ref": "Helsinki-NLP/opus-mt-en-es",
        "model_id": "opus-mt-en-es-v1"
    }
}

class ModelManager:
    """Manages loaded models with LRU eviction to constrain memory usage."""
    def __init__(self, max_models: int = MAX_HOT_MODELS):
        self.max_models = max_models
        self.cache: OrderedDict[str, Any] = OrderedDict()

    def get(self, source_lang: str, target_lang: str) -> Dict[str, Any]:
        pair_key = f"{source_lang}->{target_lang}"
        if pair_key in self.cache:
            self.cache.move_to_end(pair_key)
            return self.cache[pair_key]

        spec = MODEL_REGISTRY.get((source_lang, target_lang))
        if not spec:
            raise ValueError(f"Par de idiomas no soportado: {source_lang} -> {target_lang}")

        model_path = os.path.join(MODELS_DIR, spec["dir_name"])
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Directorio del modelo no encontrado: {model_path}")

        print(f"[ModelManager] Loading model {pair_key} from {model_path}...")
        t0 = time.perf_counter()
        
        translator = ctranslate2.Translator(model_path, device="cpu", compute_type="int8")
        entry = {
            "spec": spec,
            "translator": translator,
            "pair_key": pair_key
        }

        if spec["type"] == "marian":
            tokenizer_path = os.path.join(model_path, "tokenizer")
            if not os.path.isdir(tokenizer_path):
                raise FileNotFoundError(
                    f"Tokenizer local no encontrado para {pair_key}: {tokenizer_path}"
                )
            entry["tokenizer"] = MarianTokenizer.from_pretrained(
                tokenizer_path,
                local_files_only=True,
            )
        elif spec["type"] == "softcatala":
            sp_path = os.path.join(model_path, "sp_m.model")
            sp = spm.SentencePieceProcessor()
            sp.load(sp_path)
            entry["sp"] = sp
        elif spec["type"] == "nos":
            entry["moses_tok"] = MosesTokenizer(lang="gl")
            entry["moses_detok"] = MosesDetokenizer(lang="es")
            bpe_path = os.path.join(model_path, "gl.code")
            with open(bpe_path, "r", encoding="utf-8") as f:
                entry["bpe"] = bpe_lib.BPE(f)

        load_ms = (time.perf_counter() - t0) * 1000
        print(f"[ModelManager] Loaded {pair_key} in {load_ms:.1f} ms")

        # Evict oldest if limit reached
        if len(self.cache) >= self.max_models:
            evicted_key, _ = self.cache.popitem(last=False)
            print(f"[ModelManager] Evicted {evicted_key} from hot memory cache.")

        self.cache[pair_key] = entry
        return entry

model_manager = ModelManager(max_models=MAX_HOT_MODELS)

def translate_single_sentence(entry: Dict[str, Any], sentence: str) -> str:
    spec = entry["spec"]
    translator = entry["translator"]

    if spec["type"] == "marian":
        tok = entry["tokenizer"]
        tokens = tok.convert_ids_to_tokens(tok.encode(sentence))
        res = translator.translate_batch([tokens])
        out_ids = tok.convert_tokens_to_ids(res[0].hypotheses[0])
        return tok.decode(out_ids, skip_special_tokens=True)
    elif spec["type"] == "softcatala":
        sp = entry["sp"]
        tokens = sp.encode(sentence, out_type=str)
        res = translator.translate_batch([tokens])
        return sp.decode(res[0].hypotheses[0])
    elif spec["type"] == "nos":
        tok_gl = entry["moses_tok"]
        detok_es = entry["moses_detok"]
        bpe = entry["bpe"]
        tok_str = tok_gl.tokenize(sentence, return_str=True)
        bpe_str = bpe.process_line(tok_str)
        tokens = bpe_str.split()
        res = translator.translate_batch([tokens], beam_size=5, max_decoding_length=250, replace_unknowns=True)
        out_tokens = res[0].hypotheses[0]
        out_line = ' '.join(out_tokens).replace('@@ ', '').split()
        return detok_es.detokenize(out_line)
    else:
        raise ValueError(f"Tipo de modelo no implementado: {spec['type']}")

def sentence_split(text: str) -> list[str]:
    paragraphs = text.split('\n')
    chunks = []
    for p in paragraphs:
        if not p.strip():
            chunks.append("")
            continue
        sents = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9\(\[])|(?<=\.\s)(?=\d+\.\s)', p)
        for s in sents:
            if s.strip():
                chunks.append(s)
    return chunks

def execute_translation_pipeline(text: str, source_lang: str, target_lang: str) -> Dict[str, Any]:
    t0 = time.perf_counter()
    entry = model_manager.get(source_lang, target_lang)
    
    # 1. NormativeShield protect
    protected_text, mapping, metadata = NormativeShield.protect(text)

    # 2. Sentence splitting and translation
    sents = sentence_split(protected_text)
    if not sents:
        sents = [protected_text]

    translated_sents = []
    for s in sents:
        if not s.strip():
            translated_sents.append(s)
        else:
            translated_sents.append(translate_single_sentence(entry, s))
            
    translated_protected = ' '.join([s for s in translated_sents if s])

    # 3. NormativeShield restore
    restored_text = NormativeShield.restore(translated_protected, mapping)

    # 4. Fail-closed verification
    verification = NormativeShield.verify_fail_closed(
        original_text=text,
        translated_protected=translated_protected,
        restored_text=restored_text,
        mapping=mapping
    )

    elapsed_ms = (time.perf_counter() - t0) * 1000

    if not verification["is_valid"]:
        return {
            "ok": False,
            "status": "FAIL_CLOSED",
            "error": "La verificación de invariantes normativos rechazó la traducción.",
            "violations": verification["violations"],
            "model": entry["spec"]["model_id"],
            "elapsed_ms": round(elapsed_ms, 1)
        }

    return {
        "ok": True,
        "status": "VALID",
        "translated_text": restored_text,
        "model": entry["spec"]["model_id"],
        "provider": "local-ctranslate2",
        "source_lang": source_lang,
        "target_lang": target_lang,
        "placeholders_count": verification["placeholders_count"],
        "elapsed_ms": round(elapsed_ms, 1)
    }

class TranslationHTTPHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: Dict[str, Any]):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self._send_json(200, {
                "status": "healthy",
                "active_models": list(model_manager.cache.keys()),
                "max_hot_models": model_manager.max_models,
                "models_dir": MODELS_DIR,
                "available_pairs": [f"{s}->{t}" for s, t in MODEL_REGISTRY.keys()]
            })
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        if self.path == '/translate':
            try:
                length = int(self.headers.get('content-length', 0))
                body = json.loads(self.rfile.read(length).decode('utf-8'))
                text = body.get('text', '')
                source_lang = body.get('source_lang', '').strip().lower()
                target_lang = body.get('target_lang', '').strip().lower()

                if not text:
                    self._send_json(400, {"error": "El campo 'text' es obligatorio."})
                    return
                if not source_lang or not target_lang:
                    self._send_json(400, {"error": "source_lang y target_lang son obligatorios."})
                    return

                res = execute_translation_pipeline(text, source_lang, target_lang)
                if res["ok"]:
                    self._send_json(200, res)
                else:
                    self._send_json(422, res)
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
        else:
            self._send_json(404, {"error": "Not Found"})

def main():
    print(f"==================================================")
    print(f"UrbanBrain Local Translation Sidecar Service")
    print(f"Host: {HOST}:{PORT}")
    print(f"Models Dir: {MODELS_DIR}")
    print(f"Supported Pairs: {len(MODEL_REGISTRY)}")
    print(f"==================================================")
    server = ThreadingHTTPServer((HOST, PORT), TranslationHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Translation Service...")
        server.server_close()

if __name__ == '__main__':
    main()
