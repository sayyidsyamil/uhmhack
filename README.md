# HEAL.AI – Multilingual AI Receptionist for Clinics

HEAL.AI is developed by the team UMHackathon for the ELLM Startup Initiative 2025, a competition organised by UMSCOM. Heal.AI is a multilingual, AI-powered virtual receptionist that automates patient intake, understands any local language, and generates structured summaries for doctors in the Malaysian public health context. It reduces clinic staff cost, eliminates language barriers, and streamlines diagnosis by ensuring doctors never need to repeat basic questions.

---

## 🚀 Features

- 🎤 **Multilingual Voice Input** – Patients speak in any language; AI understands via Whisper local model.
- 📝 **Smart Registration Flow** – Automatically collects name, gender, symptoms, and follow-up details.
- 🧠 **Symptom Understanding** – Uses Gemini to interpret natural language descriptions of illness.
- 📋 **Doctor Summary Generation** – Outputs clean, structured case summaries for immediate use.
- 🔁 **Follow-Up Questions** – Dynamically asks clarifying questions like a real doctor would.
- 💾 **SQLite Integration** – Saves all patient data and summaries securely for future reference.
- 💻 **Gradio Interface** – Clean, easy-to-use frontend for patients and clinic staff.
 
---

## 🧱 Tech Stack

| Layer        | Tool / Stack                |
|--------------|-----------------------------|
| Frontend     | Gradio                      |
| Backend      | Pure Python (FastAPI optional later) |
| AI Services  | Open Sourced Whisper (STT), HuggingFace and Open-Source Models (LLM) |
| Database     | SQLite (Document-based patient record storage) |
| Deployment   | Gradio Sharing |

---



## 📂 Folder Structure

```

heal-ai/
├── app.py                  # 🎯 Main Gradio app (UI + logic)
├── clinic.db               # 📊 Database for example clinics
├── whisper\_utils.py       # 🎙️ Voice-to-text via Whisper API
├── gpt\_utils.py           # 🧠 Handles Gemini prompts & summary parsing
├── mongo\_client.py        # 💾 MongoDB connection & query handler

├── data/
│   └── temp\_audio/        # 📁 Stores temporary uploaded audio files

├── prompts/
│   └── summary\_prompt.txt # 📝 Custom GPT prompt for doctor summaries

├── .env                   # 🔐 API keys (Gemini, MongoDB URI)
├── requirements.txt       # 📦 Python dependencies
└── README.md              # 📘 Project documentation
```

---

## ⚙️ Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/sayyidsyamil/heal-ai.git
cd heal-ai
```

### 2. Create Virtual Environment
```bash
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
```

### 3. Install Requirements
```bash
pip install -r requirements.txt
```

### 4. Set Up Environment Variables
Create a .env file in the root directory:

```
OPENAI_API_KEY=your_openai_key
MONGODB_URI=your_mongo_connection_string
```

### 5. Install Gradio
```bash
pip install gradio
```

### 6. Run Gradio App
```bash
python app.py
```

---

## 🧠 How It Works

1. **User Input (Voice/Text)**: Patients speak into the mic (any language).
2. **Whisper API**: Transcribes audio.
3. **Transcription**: Passed to Gemini with a custom prompt.
4. **Symptom Understanding & Follow-Up**: Gemini generates follow-up questions based on patient input.
5. **Patient Answers**: Via text or voice again.
6. **GPT Builds a Full Clinical Summary**: Summary includes name, age, symptom, history, context.
7. **Doctor Summary Output**: Doctor sees this before meeting the patient.
8. **SQLite Storage**: All patient records saved as JSON documents.

```json
{
  "name": "Ahmad",
  "age": 43,
  "main_complaint": "Cough and fever",
  "duration": "3 days",
  "history": "No chronic illness",
  "ai_notes": "Patient also complains of fatigue",
  "timestamp": "2025-05-06T10:35:00Z"
}
```

---

## 📈 Business Impact

- Saves RM60K–80K/year per clinic by replacing receptionists.
- Improves patient experience and inclusivity (especially for elderly, rural, or non-Malay speakers).
- Gives doctors clean, usable data instantly.
- Enables fast scalability across clinics and telehealth.

---

## 🛠️ Future Roadmap

- Doctor feedback loop integration.
- EMR (Electronic Medical Record) export support.
- Analytics dashboard for clinics.
- Add appointment booking and queue number module.
- Offline audio input fallback (in case of no internet).

---

## 🤝 Contributing

We welcome contributions from doctors, developers, and AI builders.

1. Fork it 🍴
2. Create your feature branch: `git checkout -b feature/xyz`
3. Commit your changes ✅
4. Push to the branch 🚀
5. Open a Pull Request 🙏

---

## 📬 Contacts

Sayyid Syamil (Backend & Database Developer) 
<br>📧 sayyidsyamils@gmail.com</br>
<br>📍 Kuala Lumpur, Malaysia</br>
<br>🔗 [LinkedIn](https://www.linkedin.com/in/sayyidsyamil)</br>
<br></br>
<br>Wong Yoong Yee (Backend & Model Developer, Group Leader)</br>
<br>📧 mackwong1@gmail.com</br>
<br>📍 Kuala Lumpur, Malaysia</br>
<br>🔗 [LinkedIn](https://www.linkedin.com/in/mackwongyy)</br>
<br></br>
<br>Chai Jie Sheng (Frontend Developer)</br>
<br>📧 chaijiesheng88@gmail.com</br>
<br>📍 Kuala Lumpur, Malaysia</br>
<br>🔗 [LinkedIn](https://www.linkedin.com/in/chaijiesheng)</br>
<br></br>
<br>Aman Iskandar (Business Advisor)</br>
<br>📧 amaniskandar04@gmail.com</br>
<br>📍 Kuala Lumpur, Malaysia</br>
<br>🔗 [LinkedIn](https://www.linkedin.com/in/aman-iskandar-mohamad-dzulhaidi)</br>

---


