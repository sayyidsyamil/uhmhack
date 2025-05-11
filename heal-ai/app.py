import gradio as gr
import os
import re
import uuid
import torch
import librosa
from gtts import gTTS
from duckduckgo_search import DDGS
import gradio as gr
from transformers import (
    AutoModelForSpeechSeq2Seq, AutoTokenizer, WhisperProcessor,
    pipeline,
    M2M100ForConditionalGeneration, M2M100Tokenizer
)

# 1. Load models
ASR_NAME   = "mesolitica/malaysian-whisper-base"
asr_tok    = AutoTokenizer.from_pretrained(ASR_NAME)
asr_model  = AutoModelForSpeechSeq2Seq.from_pretrained(ASR_NAME)
asr_proc   = WhisperProcessor.from_pretrained(ASR_NAME)

qa_pipe = pipeline(
    "text2text-generation",
    model="google/flan-t5-small",
    tokenizer="google/flan-t5-small"
)

M2M_NAME   = "facebook/m2m100_418M"
m2m_tok    = M2M100Tokenizer.from_pretrained(M2M_NAME)
m2m_model  = M2M100ForConditionalGeneration.from_pretrained(M2M_NAME)

# 2. System prompt
SYSTEM_PROMPT = """
You are a multilingual AI-powered healthcare assistant for Malaysian public clinics and hospitals.
• You automate patient intake and collect structured symptoms and history.
• You can answer any healthcare-related question—medical advice, local service info, self-care tips, public health guidelines, etc.
• You understand all local languages (Malay, English, Chinese, Tamil, mixed code-switching).
• You generate structured summaries for doctors (name, age, main complaint, duration, history, follow-ups).
• You reduce clinic staff cost, eliminate language barriers, and streamline diagnosis.
Answer professionally, warmly, and concisely, using the latest reliable web information below.
"""

# 3. Helpers
def transcribe(audio_path: str) -> str:
    wav, sr = librosa.load(audio_path, sr=16000)
    proc = asr_proc(wav, sampling_rate=sr,
                    return_tensors="pt", return_attention_mask=True)
    feats, mask = proc.input_features, proc.attention_mask
    with torch.no_grad():
        ids = asr_model.generate(input_features=feats, attention_mask=mask)
    return asr_tok.decode(ids[0], skip_special_tokens=True)

def tts(text: str, lang_code: str = "en") -> str:
    fn = f"tts_{uuid.uuid4().hex[:8]}.mp3"
    gTTS(text, lang=lang_code).save(fn)
    return fn

def translate_m2m(text: str, target_lang: str) -> str:
    src = "ms" if target_lang == "en" else "en"
    m2m_tok.src_lang = src
    enc = m2m_tok(text, return_tensors="pt")
    bos = m2m_tok.get_lang_id(target_lang)
    out = m2m_model.generate(**enc, forced_bos_token_id=bos)
    return m2m_tok.batch_decode(out, skip_special_tokens=True)[0]

def web_search(query: str, max_results: int = 3) -> list[str]:
    lower = query.lower()
    if "hospital" in lower or "clinic" in lower:
        m = re.search(r"(?:hospital|clinic).*(?:near|from)?\s*(.*)", query, re.IGNORECASE)
        loc = m.group(1).strip() if m and m.group(1) else "Malaysia"
        kind = "hospital" if "hospital" in lower else "clinic"
        search_q = f"nearest {kind} near {loc} Malaysia"
    else:
        search_q = query

    snippets = []
    with DDGS() as ddgs:
        for r in ddgs.text(search_q, max_results=max_results):
            title = r.get("title","").strip()
            body  = r.get("body","").strip()
            href  = r.get("href","").strip()
            snippets.append(f"- {title}: {body} ({href})")
    return snippets or ["Maaf, tiada hasil ditemui."]

# 4. Gradio UI
css = """
#chatbot { height: 400px; overflow-y: auto; }
.header {
  background:#4CAF50;
  display:flex;
  justify-content:center;
  align-items:center;
  padding:15px;
}
.header img { height:30px; margin-right:12px; }
.header .title { color:white; font-size:22px; font-weight:500; }
"""

with gr.Blocks(css=css) as app:
    gr.HTML("""
      <div class="header">
        <img src="https://your-logo-url.com/logo.png" alt="Logo">
        <span class="title">Your Personal Healthcare Assistant</span>
      </div>
    """)
    
    with gr.Row():
        with gr.Column(scale=1):
            gr.Dropdown(label="Previous Conversations", choices=[], interactive=True)
        with gr.Column(scale=3):
            chatbot    = gr.Chatbot(elem_id="chatbot", type="messages")
            txt_input  = gr.Textbox(placeholder="Type your message…", show_label=False)
            aud_input  = gr.Audio(type="filepath", show_label=False)
            submit_btn = gr.Button("Submit")
            translate_btn = gr.Button("Translate", visible=False)
            lang_dd    = gr.Dropdown(["English","Bahasa Melayu"], label="Translate to…", visible=False)
            tts_player = gr.Audio(visible=False)

    # 5. Event callbacks
    def on_submit(text, history, audio):
        # Prioritise audio if provided
        if audio:
            user_msg = transcribe(audio)
        elif text and text.strip():
            user_msg = text.strip()
        else:
            return history, gr.update(visible=False), gr.update(visible=False)

        history.append({"role":"user", "content": user_msg})

        snippets = web_search(user_msg, max_results=3)
        context  = "\n".join(snippets)
        prompt   = (
            SYSTEM_PROMPT
            + "\nWeb info:\n" + context
            + f"\n\nPatient says: \"{user_msg}\"\nResponse:"
        )
        out = qa_pipe(prompt, max_length=150)[0]
        ai_reply = out["generated_text"].strip() or "Maaf, saya tak faham."

        history.append({"role":"assistant", "content": ai_reply})
        mp3 = tts(ai_reply, lang_code="en")
        return history, mp3, gr.update(visible=True), gr.update(visible=False)

    def on_translate_click():
        return gr.update(visible=False), gr.update(visible=True)

    def on_lang_select(choice, history):
        last = next(m["content"] for m in reversed(history) if m["role"]=="assistant")
        tgt  = "en" if choice=="English" else "ms"
        tr   = translate_m2m(last, tgt)
        history.append({"role":"assistant", "content": tr})
        mp3 = tts(tr, lang_code=("ms" if tgt=="ms" else "en"))
        return history, mp3, gr.update(visible=False)

    # 6. Wire up events
    submit_btn.click(
        on_submit,
        inputs=[txt_input, chatbot, aud_input],
        outputs=[chatbot, tts_player, translate_btn, lang_dd]
    )
    txt_input.submit(
        on_submit,
        inputs=[txt_input, chatbot, aud_input],
        outputs=[chatbot, tts_player, translate_btn, lang_dd]
    )
    translate_btn.click(on_translate_click, [], [translate_btn, lang_dd])
    lang_dd.change(on_lang_select, [lang_dd, chatbot], [chatbot, tts_player, lang_dd])

    # 7. Enable queuing with concurrency limits
    app.queue(max_size=4, default_concurrency_limit=2).launch()