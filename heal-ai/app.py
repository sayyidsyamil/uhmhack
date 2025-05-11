import gradio as gr
import uuid
import torch
import librosa
from gtts import gTTS
from duckduckgo_search import DDGS
from transformers import (
    AutoModelForSpeechSeq2Seq, AutoTokenizer, WhisperProcessor,
    pipeline,
    M2M100ForConditionalGeneration, M2M100Tokenizer
)

# 1. Load models
# Whisper for Malay/English ASR
ASR_NAME   = "mesolitica/malaysian-whisper-base"
asr_tok    = AutoTokenizer.from_pretrained(ASR_NAME)
asr_model  = AutoModelForSpeechSeq2Seq.from_pretrained(ASR_NAME)
asr_proc   = WhisperProcessor.from_pretrained(ASR_NAME)

# Instruction-tuned FLAN-T5-Small for responses
flan_pipe = pipeline(
    "text2text-generation",
    model="google/flan-t5-small",
    tokenizer="google/flan-t5-small"
)

# M2M100 for Malay↔English translation
M2M_NAME   = "facebook/m2m100_418M"
m2m_tok    = M2M100Tokenizer.from_pretrained(M2M_NAME)
m2m_model  = M2M100ForConditionalGeneration.from_pretrained(M2M_NAME)

# 2. System prompt
SYSTEM_PROMPT = """
You are a multilingual AI-powered virtual receptionist for Malaysian public health centres.
• You automate patient intake.
• You understand any local language (Malay, English, Chinese, Tamil, code-switching).
• You generate structured summaries for doctors (name, age, complaint, duration, history, follow-ups).
• You reduce clinic staff cost, eliminate language barriers, and streamline diagnosis.
Answer warmly and concisely, using the latest web information below.
"""

# 3. Helper functions
def transcribe(audio_path):
    wav, sr = librosa.load(audio_path, sr=16000)
    proc = asr_proc(wav, sampling_rate=sr,
                    return_tensors="pt", return_attention_mask=True)
    feats, mask = proc.input_features, proc.attention_mask
    with torch.no_grad():
        ids = asr_model.generate(input_features=feats, attention_mask=mask)
    return asr_tok.decode(ids[0], skip_special_tokens=True)

def tts(text, lang_code="en"):
    fn = f"tts_{uuid.uuid4().hex[:8]}.mp3"
    gTTS(text, lang=lang_code).save(fn)
    return fn

def translate(text, target_lang):
    src = "ms" if target_lang=="en" else "en"
    m2m_tok.src_lang = src
    enc = m2m_tok(text, return_tensors="pt")
    bos = m2m_tok.get_lang_id(target_lang)
    out = m2m_model.generate(**enc, forced_bos_token_id=bos)
    return m2m_tok.batch_decode(out, skip_special_tokens=True)[0]

def web_search(query, max_results=3):
    """
    Free DuckDuckGo search via DDGS.
    Returns up to max_results snippets.
    """
    snippets = []
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=max_results):
            title = r.get("title","").strip()
            body  = r.get("body","").strip()
            href  = r.get("href","").strip()
            snippets.append(f"- {title}: {body} ({href})")
    return snippets or ["No results found."]

# 4. Build Gradio UI
css = """
#chatbot { height: 400px; overflow-y: auto; }
.header {
  background:#4CAF50;
  display:flex;
  justify-content:center;
  align-items:center;
  padding:15px;
}
.header img { height:30px; margin-right:10px; }
.header .title { color:white; font-size:22px; font-weight:500; }
"""

with gr.Blocks(css=css) as app:
    # Header bar
    gr.HTML("""
      <div class="header">
        <img src="HEAL.AI.png" alt="Logo">
        <span class="title">Your Personal Healthcare Assistant</span>
      </div>
    """)
    with gr.Row():
        with gr.Column(scale=1):
            gr.Dropdown(label="Previous Conversations", choices=[], interactive=True)
        with gr.Column(scale=3):
            chatbot       = gr.Chatbot(elem_id="chatbot", type="messages")
            txt_input     = gr.Textbox(placeholder="Type your message…", show_label=False)
            aud_input     = gr.Audio(type="filepath", show_label=False)
            submit_btn    = gr.Button("Submit")
            translate_btn = gr.Button("Translate", visible=False)
            lang_dd       = gr.Dropdown(
                                ["English","Bahasa Melayu"],
                                label="Translate to…",
                                visible=False
                            )
            tts_player    = gr.Audio(visible=False)

    # 5. Event callbacks
    def on_submit(text, history, audio):
        # 1) Determine user message
        if text and text.strip():
            user_msg = text.strip()
        elif audio:
            user_msg = transcribe(audio)
        else:
            return history, None, gr.update(visible=False), gr.update(visible=False)

        history.append({"role":"user", "content": user_msg})

        # 2) Perform web search
        snippets = web_search(user_msg, max_results=3)
        context  = "\n".join(snippets)

        # 3) Build full prompt
        prompt = (
            SYSTEM_PROMPT
            + "\nWeb info:\n" + context
            + f"\n\nPatient says: \"{user_msg}\"\nResponse:"
        )

        # 4) Generate assistant reply
        out = flan_pipe(prompt, max_length=150)[0]
        ai_reply = out["generated_text"].strip() or "Maaf, saya tak faham."

        history.append({"role":"assistant", "content": ai_reply})

        # 5) TTS playback
        mp3 = tts(ai_reply, lang_code="en")

        # 6) Clear inputs & show Translate button
        return (
            history,
            mp3,
            gr.update(visible=True),    # show Translate
            gr.update(visible=False)    # hide dropdown
        )

    def on_translate_click():
        return gr.update(visible=False), gr.update(visible=True)

    def on_lang_select(choice, history):
        last = next(m["content"] for m in reversed(history) if m["role"]=="assistant")
        tgt  = "en" if choice=="English" else "ms"
        tr   = translate(last, tgt)
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
    translate_btn.click(
        on_translate_click,
        inputs=[],
        outputs=[translate_btn, lang_dd]
    )
    lang_dd.change(
        on_lang_select,
        inputs=[lang_dd, chatbot],
        outputs=[chatbot, tts_player, lang_dd]
    )

    # 7. Enable queuing with concurrency limits
    app.queue(max_size=4, default_concurrency_limit=2).launch()