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

def create_tts_button(text):
    msg_id = str(uuid.uuid4())[:8]
    audio_file = f"tts_{msg_id}.mp3"
    tts = gTTS(text)
    tts.save(audio_file)
    return audio_file

def bot(text_input, audio_input):
    if text_input:
        response = text_input
    else:
        response = "No text input provided."

    if audio_input:
        y, sr = librosa.load(audio_input, sr=16000)

        input_features = processor(y, sampling_rate=16000, return_tensors="pt").input_features

        with torch.no_grad():
            generated_ids = model.generate(input_features, return_timestamps=True, language="ms")

        response = tokeniser.decode(generated_ids[0], skip_special_tokens=True)

    audio_file = create_tts_button(response)

    return gr.Textbox(value=response, interactive=False, show_label="Text Output"), gr.Audio(value=audio_file, label="Response Audio", autoplay=True)

with gr.Blocks() as iface:
    header_component = gr.HTML("""
        <div style="background-color: #4CAF50; padding: 10px; text-align: center; color: white; font-size: 24px;">
            <img src="https://www.shutterstock.com/image-photo/awesome-pic-natureza-600nw-2408133899.jpg" alt="Logo" style="height: 40px; vertical-align: middle;">
            <span style="vertical-align: middle; margin-left: 10px;">Heal.AI App</span>
        </div>
    """)
    
    text_input = gr.Textbox(placeholder="Enter your message", lines=1)
    audio_input = gr.Audio(type="filepath")
    submit_button = gr.Button("Submit")
    text_output = gr.Textbox(label="Text Output")
    audio_output = gr.Audio(label="Response Audio")

    # Set up the interaction for the submit button
    submit_button.click(
        fn=bot,
        inputs=[text_input, audio_input],
        outputs=[text_output, audio_output]
    )

iface.launch()