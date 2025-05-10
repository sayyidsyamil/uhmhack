import gradio as gr
from gtts import gTTS
import uuid
import os

assistant_history = []

def add_user_message(history, message):
    for x in message["files"]:
        history.append(gr.Row.update([gr.Textbox(value=f"[file] {x}", interactive=False)]))
    if message["text"] is not None:
        history.append(gr.Row.update([gr.Textbox(value=message["text"], interactive=False)]))
    return history, gr.MultimodalTextbox(value=None, interactive=False)

def create_tts_button(text):
    msg_id = str(uuid.uuid4())[:8]
    audio_file = f"tts_{msg_id}.mp3"
    tts = gTTS(text)
    tts.save(audio_file)
    return audio_file

def bot(history):
    response = "That's cool!"
    audio_file = create_tts_button(response)
    with gr.Row() as row:
        textbox = gr.Textbox(value=response, interactive=False, show_label=False)
        speak_button = gr.Button("🔊", size="sm")
        audio_output = gr.Audio(value=None, label=None, autoplay=True, visible=False)

        def play_audio():
            audio_output.visible = True
            return audio_file

        speak_button.click(play_audio, outputs=[audio_output])

    history.append(row)
    return history

with gr.Blocks() as demo:
    history_display = gr.State([])

    layout = gr.Column()
    with layout:
        message_stack = gr.Column()

        chat_input = gr.MultimodalTextbox(
            interactive=True,
            file_count="multiple",
            placeholder="Enter message or upload file...",
            show_label=False,
            sources=["microphone", "upload"],
        )

        def update_ui(message_stack, chat_input_value):
            messages, _ = add_user_message(message_stack, chat_input_value)
            messages = bot(messages)
            return messages, gr.MultimodalTextbox(value=None, interactive=True)

        chat_input.submit(
            fn=update_ui,
            inputs=[message_stack, chat_input],
            outputs=[message_stack, chat_input],
        )

    demo.launch()
