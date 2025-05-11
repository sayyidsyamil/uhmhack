import gradio as gr
import uuid
import torch
import librosa
from gtts import gTTS
from transformers import (
    AutoModelForSpeechSeq2Seq, AutoTokenizer, WhisperProcessor,
    AutoModelForCausalLM, pipeline,
    M2M100ForConditionalGeneration, M2M100Tokenizer
)

# 1. Load models
# Whisper for Malay/English ASR
ASR_NAME = "mesolitica/malaysian-whisper-base"
asr_tok = AutoTokenizer.from_pretrained(ASR_NAME)
asr_model = AutoModelForSpeechSeq2Seq.from_pretrained(ASR_NAME)
asr_proc = WhisperProcessor.from_pretrained(ASR_NAME)

# DialoGPT-medium for AI replies
CHAT_NAME = "microsoft/DialoGPT-medium"
chat_tok = AutoTokenizer.from_pretrained(CHAT_NAME)
chat_model = AutoModelForCausalLM.from_pretrained(CHAT_NAME)
chat_model.config.pad_token_id = chat_model.config.eos_token_id
chat_pipe = pipeline(
    "text-generation",
    model=chat_model,
    tokenizer=chat_tok,
    pad_token_id=chat_model.config.eos_token_id,
    return_full_text=False,
    truncation=True
)

# M2M100 for translation
M2M_NAME   = "facebook/m2m100_418M"
m2m_tok    = M2M100Tokenizer.from_pretrained(M2M_NAME)
m2m_model  = M2M100ForConditionalGeneration.from_pretrained(M2M_NAME)

# 2. Helper functions
def transcribe(audio_path):
    wav, sr = librosa.load(audio_path, sr=16000)
    proc_out = asr_proc(
        wav,
        sampling_rate=sr,
        return_tensors="pt",
        return_attention_mask=True
    )
    feats = proc_out.input_features
    mask  = proc_out.attention_mask
    with torch.no_grad():
        ids = asr_model.generate(input_features=feats, attention_mask=mask)
    return asr_tok.decode(ids[0], skip_special_tokens=True)

def tts(text):
    fn = f"tts_{uuid.uuid4().hex[:8]}.mp3"
    gTTS(text).save(fn)
    return fn

def translate_m2m(text, target_lang):
    src_lang = "ms" if target_lang=="en" else "en"
    m2m_tok.src_lang = src_lang
    encoded = m2m_tok(text, return_tensors="pt")
    bos_id  = m2m_tok.get_lang_id(target_lang)
    out     = m2m_model.generate(**encoded, forced_bos_token_id=bos_id)
    return m2m_tok.batch_decode(out, skip_special_tokens=True)[0]

# 3. Build Gradio UI
css = """
#chatbot { height: 400px; overflow-y: auto; }
.header {
  background:#4CAF50;
  display:flex;
  justify-content:center;
  align-items:center;
  padding:10px;
}
.header img { height:30px; margin-right:10px; }
.header .title { color:white; font-size:20px; }
"""

with gr.Blocks(css=css) as app:
    # Header
    gr.HTML("""
    <div class="header">
      <img src="HEAL.AI.png" alt="HEAL.AI Logo">
      <span class="title">Your Personal Healthcare Assistant</span>
    </div>
    """)

    with gr.Row():
        with gr.Column(scale=1):
            gr.Dropdown(label="Previous Conversations", choices=[], interactive=True)
        with gr.Column(scale=3):
            chatbot = gr.Chatbot(elem_id="chatbot", type="messages")
            txt_input = gr.Textbox(placeholder="Type your message…", show_label=False)
            aud_input = gr.Audio(type="filepath", show_label=False)
            submit_btn = gr.Button("Submit")
            translate_btn = gr.Button("Translate", visible=False)
            lang_dd = gr.Dropdown(["English","Bahasa Melayu"], label="Translate to…", visible=False)
            tts_player = gr.Audio(visible=False)

    # 4. Callbacks
    def on_submit(text, history, audio):
        # 1) Text takes priority; otherwise transcribe audio
        if text and text.strip():
            user_msg = text.strip()
        elif audio:
            user_msg = transcribe(audio)
        else:
            # no input
            return history, None, gr.update(visible=False), gr.update(visible=False), gr.update(value=""), gr.update(value=None)

        # 2) Append user message
        history.append({"role":"user", "content": user_msg})

        # 3) Generate AI response
        out = chat_pipe(
            user_msg,
            max_length=len(chat_tok(user_msg)["input_ids"]) + 50
        )[0]
        ai_reply = out.get("generated_text", "").strip()
        if not ai_reply:
            ai_reply = "Maaf, saya tak faham."

        history.append({"role":"bot", "content": ai_reply})

        # 4) Produce TTS for the AI response
        mp3 = tts(ai_reply)

        # 5) Clear inputs & reveal Translate button
        return (
            history,
            mp3,
            gr.update(visible=True),    # show Translate
            gr.update(visible=False),   # hide language dropdown
            gr.update(value=""),        # clear text box
            gr.update(value=None)       # clear audio
        )

    def on_translate_click():
        # hide Translate, show language dropdown
        return gr.update(visible=False), gr.update(visible=True)

    def on_lang_select(choice, history):
        # translate last AI message
        last = next(m["content"] for m in reversed(history) if m["role"]=="bot")
        tgt  = "en" if choice=="English" else "ms"
        tr   = translate_m2m(last, tgt)
        history.append({"role":"bot", "content": tr})
        mp3 = tts(tr)
        # hide dropdown
        return history, mp3, gr.update(visible=False)

    # 5. Wire up events
    submit_btn.click(
        on_submit,
        inputs=[txt_input, chatbot, aud_input],
        outputs=[chatbot, tts_player, translate_btn, lang_dd, txt_input, aud_input]
    )
    txt_input.submit(
        on_submit,
        inputs=[txt_input, chatbot, aud_input],
        outputs=[chatbot, tts_player, translate_btn, lang_dd, txt_input, aud_input]
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

    app.launch()
