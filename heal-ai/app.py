import gradio as gr
from gtts import gTTS
import uuid
from transformers import AutoModelForSpeechSeq2Seq, AutoTokenizer, WhisperProcessor
import torch
import librosa
import numpy as np

model_name = "mesolitica/malaysian-whisper-base"
tokeniser = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSpeechSeq2Seq.from_pretrained(model_name)
processor = WhisperProcessor.from_pretrained(model_name)

conversation_history = []

def create_tts_button(text):
    msg_id = str(uuid.uuid4())[:8]
    audio_file = f"tts_{msg_id}.mp3"
    tts = gTTS(text)
    tts.save(audio_file)
    return audio_file

def bot(user_input, chat_history, audio_input):
    if audio_input:
        try:
            y, sr = librosa.load(audio_input, sr=16000)

            input_features = processor(y, sampling_rate=16000, return_tensors="pt").input_features

            with torch.no_grad():
                generated_ids = model.generate(input_features, return_timestamps=True, language="ms")

            response = tokeniser.decode(generated_ids[0], skip_special_tokens=True)

        except Exception as e:
            response = f"Error processing audio: {e}"

    elif user_input:
        response = user_input

    else:
        response = "No text input provided."

    chat_history.append({"role": "user", "content": user_input})
    chat_history.append({"role": "bot", "content": response})

    audio_file = create_tts_button(response)
    conversation_history.append((user_input, response))

    return chat_history, gr.Audio(value=audio_file, label="Response Audio", autoplay=True)

header = gr.HTML("""
    <div class="header">
        <img src="https://your-logo-url.com/logo.png" alt="Logo" class="logo">
        <span class="title">Voice Assistant</span>
    </div>
""")

with gr.Blocks() as iface:
    header_component = gr.HTML("""
        <div class="header">
            <img src="https://your-logo-url.com/logo.png" alt="Logo" style="height: 40px; vertical-align: middle;">
            <span style="vertical-align: middle; margin-left: 10px;">Voice Assistant</span>
        </div>
    """)

    with gr.Row():
        with gr.Column(scale=1):
            conversation_list = gr.Dropdown(
                label="Previous Conversations",
                choices=[f"Conversation {i+1}" for i in range(len(conversation_history))],
                interactive=True
            )
        with gr.Column(scale=3):
            chatbot = gr.Chatbot(label="Chat History", type="messages")

            user_input = gr.Textbox(placeholder="Enter your message", lines=1)
            audio_input = gr.Audio(type="filepath", label="Upload Audio")

            submit_button = gr.Button("Submit")
            submit_button.click(fn=bot, inputs=[user_input, chatbot, audio_input], outputs=[chatbot, gr.Audio()])

    iface.css = "styles.css"

iface.launch()