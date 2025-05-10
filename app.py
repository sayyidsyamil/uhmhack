import gradio as gr
from gtts import gTTS
import uuid
import time

def add_message(history, message):
    new_history = history.copy()
    for x in message["files"]:
        new_history.append({"role": "user", "content": {"path": x}})  # Changed to "path"
    if message["text"] is not None:
        new_history.append({"role": "user", "content": message["text"]})
    return new_history, gr.MultimodalTextbox(value=None, interactive=False)

def bot_response(history):
    response = "That's cool!"
    audio_file = f"temp_{uuid.uuid4()}.mp3"
    tts = gTTS(response)
    tts.save(audio_file)
    
    # Get the Gradio server URL (works when running locally)
    base_url = "http://127.0.0.1:7860"
    
    # Create message with play button
    message = {
        "role": "assistant",
        "content": f"""
        <div style="display: flex; align-items: center; gap: 8px;">
            {response}
            <button onclick='new Audio("{base_url}/file={audio_file}").play()' 
                    style="background: none; border: none; cursor: pointer; font-size: 16px;">
                🔊
            </button>
        </div>
        """
    }
    
    new_history = history.copy()
    new_history.append(message)
    return new_history

with gr.Blocks() as demo:
    chatbot = gr.Chatbot(elem_id="chatbot", bubble_full_width=False, type="messages")
    
    chat_input = gr.MultimodalTextbox(
        interactive=True,
        file_count="multiple",
        placeholder="Enter message or upload file...",
        show_label=False,
        sources=["microphone", "upload"],
    )
    
    # Add JavaScript for audio playback
    demo.head = """
    <script>
    function playAudio(button) {
        const audioPath = button.getAttribute('data-audio');
        const audio = new Audio(audioPath);
        audio.play();
    }
    </script>
    """
    
    chat_msg = chat_input.submit(add_message, [chatbot, chat_input], [chatbot, chat_input])
    bot_msg = chat_msg.then(bot_response, chatbot, chatbot)
    bot_msg.then(lambda: gr.MultimodalTextbox(interactive=True), None, [chat_input])

if __name__ == "__main__":
    demo.launch()