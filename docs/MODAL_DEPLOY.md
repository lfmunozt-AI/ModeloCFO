# Fase 2 — Servir el modelo CFO propio en Modal (vLLM)

Guía paso a paso para pasar de `gpt-4o-mini` a **nuestro** modelo fine-tuneado
(Mistral 7B + LoRA), servido con vLLM en Modal sobre GPU **L4** con
**scale-to-zero**. El objetivo final: exponer un endpoint **compatible con la API
de OpenAI** y apuntar `LLM_BASE_URL` a él **sin tocar el código de la app**.

Pipeline:

```
LoRA (adapter)
  └─ 1. merge con Unsloth  → modelo full-weights fusionado
       └─ 2. cuantización AWQ → pesos int4 (cabe holgado en una L4 de 24 GB)
            └─ 3. modal: vLLM serve con scale-to-zero
                 └─ 4. apuntar LLM_BASE_URL al endpoint
```

---

## 0. Requisitos

- Checkpoint del adapter LoRA (salida del entrenamiento).
- Cuenta en Modal (`pip install modal && modal token new`).
- Cuenta en Hugging Face (token) si subes los pesos a un repo privado
  (recomendado para no versionar pesos en git).
- GPU local o de Modal para los pasos 1–2 (el merge/cuantización es puntual).

---

## 1. Merge del LoRA con Unsloth

El adapter LoRA son matrices de bajo rango que se suman a los pesos base. vLLM
sirve mejor un modelo ya fusionado. Unsloth lo hace con `save_pretrained_merged`.

```python
# merge_lora.py  (ejecutar una vez, en GPU)
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="outputs/checkpoint-final",   # carpeta del adapter LoRA
    max_seq_length=4096,
    dtype=None,            # auto (bf16 si la GPU lo soporta)
    load_in_4bit=False,    # cargamos en 16-bit para fusionar a precisión completa
)

# Fusiona LoRA → pesos y guarda en formato HF en 16-bit.
model.save_pretrained_merged(
    "modelo-cfo-merged",
    tokenizer,
    save_method="merged_16bit",   # merged_16bit | merged_4bit | lora
)

# (Opcional) súbelo a un repo privado de HF para los siguientes pasos.
# model.push_to_hub_merged("tu-org/modelo-cfo-merged", tokenizer,
#                          save_method="merged_16bit", token="hf_...")
```

Resultado: `modelo-cfo-merged/` con `config.json`, `*.safetensors`, tokenizer.
Es un modelo Mistral estándar, ya sin dependencia de Unsloth para servirlo.

---

## 2. Cuantización AWQ (int4)

AWQ reduce el modelo a ~4 bits con pérdida de calidad mínima y mejora mucho el
throughput en vLLM. Mistral 7B en AWQ ocupa ~4–5 GB → cómodo en una L4 (24 GB),
dejando memoria de sobra para el KV-cache.

```python
# quantize_awq.py  (ejecutar una vez, en GPU)
from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

src = "modelo-cfo-merged"           # o "tu-org/modelo-cfo-merged"
dst = "modelo-cfo-awq"

model = AutoAWQForCausalLM.from_pretrained(src, device_map="auto")
tokenizer = AutoTokenizer.from_pretrained(src, trust_remote_code=True)

quant_config = {
    "zero_point": True,
    "q_group_size": 128,
    "w_bit": 4,
    "version": "GEMM",
}
model.quantize(tokenizer, quant_config=quant_config)

model.save_quantized(dst)
tokenizer.save_pretrained(dst)
# Recomendado: súbelo a HF privado y sirve desde ahí en el paso 3.
# model.push_to_hub(dst, ...)  /  o usa `huggingface-cli upload`.
```

`pip install autoawq`. Si AWQ diera problemas con tu versión de Mistral, GPTQ
(`auto-gptq`) es la alternativa equivalente; vLLM soporta ambos con
`--quantization awq` o `--quantization gptq`.

---

## 3. Servir con vLLM en Modal (scale-to-zero, GPU L4)

vLLM expone de fábrica un servidor **OpenAI-compatible**
(`/v1/chat/completions`, `/v1/completions`, `/v1/models`). Lo levantamos como
web server en Modal con `@modal.web_server`, y dejamos que Modal escale a cero
cuando no hay tráfico (`scaledown_window`), de modo que no se paga GPU en reposo.

```python
# serve_vllm.py
import subprocess
import modal

MODEL_REPO = "tu-org/modelo-cfo-awq"   # repo HF privado con los pesos AWQ
VLLM_PORT = 8000

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm==0.6.6", "huggingface_hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

app = modal.App("modelo-cfo-vllm")

# La API key del endpoint y el token de HF como Secrets de Modal (no en git).
#   modal secret create modelo-cfo-llm LLM_API_KEY=sk-...
#   modal secret create huggingface HF_TOKEN=hf_...
secrets = [
    modal.Secret.from_name("modelo-cfo-llm"),
    modal.Secret.from_name("huggingface"),
]

# Cachea los pesos descargados entre arranques en frío para acelerar el cold start.
hf_cache = modal.Volume.from_name("hf-cache", create_if_missing=True)


@app.function(
    image=image,
    gpu="L4",                       # 24 GB; sobra para Mistral 7B AWQ
    secrets=secrets,
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,           # scale-to-zero tras 5 min sin tráfico
    timeout=60 * 30,
    min_containers=0,               # 0 = no se paga GPU en reposo
)
@modal.web_server(port=VLLM_PORT, startup_timeout=60 * 10)
def serve():
    cmd = [
        "vllm", "serve", MODEL_REPO,
        "--quantization", "awq",
        "--host", "0.0.0.0",
        "--port", str(VLLM_PORT),
        "--max-model-len", "4096",
        "--gpu-memory-utilization", "0.90",
        # Protege el endpoint: el cliente debe enviar este mismo valor como
        # Authorization: Bearer <LLM_API_KEY>. Inyectado vía Secret de Modal.
        "--api-key", "$LLM_API_KEY",
    ]
    subprocess.Popen(" ".join(cmd), shell=True)
```

Despliegue:

```bash
modal deploy serve_vllm.py
```

Modal imprime la URL pública del web server, p. ej.:

```
https://tu-org--modelo-cfo-vllm-serve.modal.run
```

Notas operativas:

- **Cold start:** el primer request tras escalar a cero arranca un contenedor +
  carga el modelo (decenas de segundos). El `Volume` de caché de HF reduce el
  tiempo en arranques posteriores. Si necesitas latencia constante, sube
  `min_containers=1` (paga GPU en reposo) o usa `buffer_containers`.
- **Concurrencia:** para 5 usuarios, un contenedor sobra. vLLM hace batching
  continuo de las peticiones concurrentes.
- **`--max-model-len`** debe cubrir el prompt construido por la app
  (system + RAG + 10 mensajes). Súbelo si añades más contexto RAG.

---

## 4. Apuntar la app al endpoint

Cambiar de proveedor es **solo configuración** — no se toca ni una línea de
código. En `.env.local` (local) o en las variables de entorno de Vercel:

```bash
LLM_BASE_URL=https://tu-org--modelo-cfo-vllm-serve.modal.run/v1
LLM_API_KEY=sk-...           # el mismo valor del Secret modelo-cfo-llm
LLM_MODEL=tu-org/modelo-cfo-awq   # el id con el que vLLM registró el modelo
```

- `LLM_BASE_URL` termina en **`/v1`** (vLLM expone la API ahí).
- `LLM_MODEL` debe coincidir con el id que devuelve `GET /v1/models` del
  servidor vLLM (normalmente el repo/ruta que pasaste a `vllm serve`).

Verificación rápida del endpoint (sin la app):

```bash
curl $LLM_BASE_URL/chat/completions \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"'"$LLM_MODEL"'","messages":[{"role":"user","content":"hola"}]}'
```

Si responde, reinicia la app (`npm run dev` / redeploy en Vercel) y el chat ya
estará hablando con el modelo CFO propio. `lib/llm.ts` no cambia.

---

## Checklist de corte (gpt-4o-mini → modelo propio)

- [ ] `modelo-cfo-merged` generado con Unsloth y verificado (responde en local).
- [ ] `modelo-cfo-awq` cuantizado y subido a HF privado.
- [ ] `modal deploy serve_vllm.py` OK; `GET /v1/models` lista el modelo.
- [ ] Secrets de Modal creados (`LLM_API_KEY`, `HF_TOKEN`).
- [ ] `curl` de prueba al endpoint responde.
- [ ] `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` actualizados en Vercel.
- [ ] Smoke test del chat en producción.
