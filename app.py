import gradio as gr
from gtts import gTTS
import time
import os

def print_like_dislike(x: gr.LikeData):
    print(x.index, x.value, x.liked)

def add_message(history, message):
    for x in message["files"]:
        history.append({"role": "user", "content": {"path": x}})
    if message["text"] is not None:
        history.append({"role": "user", "content": message["text"]})
    return history, gr.MultimodalTextbox(value=None, interactive=False)

def bot(history: list):
    response = "That's cool!"
    history.append({"role": "assistant", "content": ""})
    for character in response:
        history[-1]["content"] += character
        time.sleep(0.02)
        yield history

def text_to_speech(history):
    if not history:
        return None
    # Get the last assistant message
    last_msg = next((m["content"] for m in reversed(history) if m["role"] == "assistant"), "")
    if not last_msg:
        return None

    tts = gTTS(last_msg)
    file_path = "tts_output.mp3"
    tts.save(file_path)
    return file_path

with gr.Blocks() as demo:
    chatbot = gr.Chatbot(elem_id="chatbot", bubble_full_width=False, type="messages")
    chat_input = gr.MultimodalTextbox(
        interactive=True,
        file_count="multiple",
        placeholder="Enter message or upload file...",
        show_label=False,
        sources=["microphone", "upload"],
    )
    tts_audio = gr.Audio(label="Assistant Voice", autoplay=True)
    tts_button = gr.Button("🔊 Speak Last Reply")

    chat_msg = chat_input.submit(add_message, [chatbot, chat_input], [chatbot, chat_input])
    bot_msg = chat_msg.then(bot, chatbot, chatbot)
    bot_msg.then(lambda: gr.MultimodalTextbox(interactive=True), None, [chat_input])

    tts_button.click(fn=text_to_speech, inputs=[chatbot], outputs=[tts_audio])
    chatbot.like(print_like_dislike, None, None, like_user_message=True)

if __name__ == "__main__":
    demo.launch()
