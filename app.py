import gradio as gr
from gtts import gTTS
import uuid
import os
from transformers import AutoModelForSpeechSeq2Seq, AutoTokenizer, WhisperProcessor
import torch
import librosa
import numpy as np

model_name = "mesolitica/malaysian-whisper-base"
tokenizer = AutoTokenizer.from_pretrained(model_name)
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
        
        response = tokenizer.decode(generated_ids[0], skip_special_tokens=True)

    audio_file = create_tts_button(response)
    
    return (
        gr.Textbox(value=response, interactive=False, show_label=False),
        audio_input,
        gr.Audio(value=audio_file, label="Response Audio", autoplay=True)
    )

iface = gr.Interface(
    fn=bot, 
    inputs=[gr.Textbox(placeholder="Enter your message", lines=1), gr.Audio(type="filepath")], 
    outputs=[gr.Textbox(), gr.Audio(), gr.Audio()]
)

iface.launch()
