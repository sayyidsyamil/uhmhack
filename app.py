import gradio as gr
from gtts import gTTS
import uuid

# Initialize conversation database with all topics
conversations_db = {
    "General": [],
    "Health": [],
    "Wellness": [],
    "Fitness": []
}

def add_message(history, message, current_topic):
    new_history = history.copy()
    # Handle files
    for x in message["files"]:
        msg = {"role": "user", "content": {"path": x}}
        new_history.append(msg)
        conversations_db[current_topic].append(msg)
    
    # Handle text
    if message["text"] is not None:
        msg = {"role": "user", "content": message["text"]}
        new_history.append(msg)
        conversations_db[current_topic].append(msg)
    
    return new_history, gr.MultimodalTextbox(value=None, interactive=False)

def bot_response(history, current_topic):
    response = f"That's cool! (Topic: {current_topic})"
    audio_file = f"temp_{uuid.uuid4()}.mp3"
    tts = gTTS(response)
    tts.save(audio_file)
    
    base_url = "http://127.0.0.1:7860"
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
    conversations_db[current_topic].append(message)
    return new_history

def load_topic(topic_name):
    return conversations_db.get(topic_name, [])

with gr.Blocks() as demo:
    # Initialize topics from our database
    topic_list = list(conversations_db.keys())
    
    with gr.Sidebar(position="left"):
        gr.Markdown("# HEAL.AI")
        gr.Markdown("Check out the previous conversations!")
         
        conversation_topic = gr.Dropdown(
            choices=topic_list,  # Use the actual list of topics
            label="Choose the topic of conversation",
            value="General"
        )

    chatbot = gr.Chatbot(elem_id="chatbot", bubble_full_width=False, type="messages")
    
    chat_input = gr.MultimodalTextbox(
        interactive=True,
        file_count="multiple",
        placeholder="Enter message or upload file...",
        show_label=False,
        sources=["microphone", "upload"],
    )
    
    # Connect topic selection to chat loading
    conversation_topic.change(
        load_topic,
        inputs=conversation_topic,
        outputs=chatbot
    )
    
    # Update message handlers to include current topic
    chat_msg = chat_input.submit(
        add_message, 
        [chatbot, chat_input, conversation_topic], 
        [chatbot, chat_input]
    )
    
    bot_msg = chat_msg.then(
        bot_response, 
        [chatbot, conversation_topic], 
        chatbot
    )
    
    bot_msg.then(
        lambda: gr.MultimodalTextbox(interactive=True), 
        None, 
        [chat_input]
    )

if __name__ == "__main__":
    demo.launch()