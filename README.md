
# HEAL.ai – Digital Front-Liner for Malaysian Clinics

HEAL.ai is developed by the **UMHackathon** team for the **ELLM Startup Initiative 2025**, a competition organized by **UMSCOM**. Heal.AI is a multilingual, AI-powered virtual receptionist that automates patient intake, understands any local language, and generates structured summaries for doctors in the Malaysian public health context. It reduces clinic staff costs, eliminates language barriers, and streamlines diagnosis by ensuring doctors never need to repeat basic questions.

HEAL.ai is built to function in **Klinik Kesihatan** and **Hospital Kerajaan** settings across Malaysia, providing a seamless experience for both patients and healthcare providers. It triages patients, searches or registers them in the database, logs the visit, auto-assigns a queue number based on doctor availability, and delivers concise visit summaries in **simple Malaysian English** and **Bahasa Malaysia**. This makes it easy to understand for all users, from clinic staff to patients.

---

## 🚀 Key Features

| Step         | What Happens                                                          | Tools Involved              |
|--------------|-----------------------------------------------------------------------|-----------------------------|
| **1. Triage** | AI asks symptoms and follow-up questions in plain language.           | Conversation Model (Gemini) |
| **2. Search**  | `patient_search_tool` looks up patients by IC number, passport, or name. | MCP + Custom                |
| **3. Register** | If the patient is not found, AI registers them and completes missing fields. | Custom                     |
| **4. Visit Qs** | AI collects chief complaint, duration, and severity (in simple terms). | –                           |
| **5. Doctor Pick** | AI matches patient to available doctor based on specialization.     | MCP                         |
| **6. Log & Queue** | AI logs the visit and assigns a queue number automatically (e.g., KL###). | Custom                     |
| **7. Summary**  | AI generates a concise visit summary for the doctor.                  | –                           |

*Note: All tools are preceded by `list_tables` and `describe_table` to ensure schema alignment.*

---

## 🧱 Tech Stack

| Layer          | Stack / Library                               |
|----------------|-----------------------------------------------|
| **Frontend**    | **Next.js 15** (App Router) + **TypeScript**  |
| **UI Components** | **shadcn/ui** (Radix + Tailwind)            |
| **Icons**        | **Lucide-react**                              |
| **State / React** | Client components with hooks                |
| **Backend API**  | Next.js Route Handlers (`/api/general`, `/api/admin`) |
| **AI**           | **Gemini 2.5** function-calling API           |
| **Tool Runtime** | **Model Context Protocol (MCP)** – SQLite server + custom tools |
| **Database**     | **SQLite** (`lib/clinic.db`)                  |
| **Auth / Admin** | Simple bearer token in dev (future NextAuth)  |
| **Deployment**   | Vercel / Node 18 (works locally with `npm run dev`) |

---

## 📂 Folder Structure (Simplified)

```text
heal-ai/
├── app/                       # Next.js app router
│   ├── page.tsx               # Chat UI (client component)
│   ├── admin/                 # Admin dashboard UI
│   └── api/
│       ├── general/route.ts   # Gemini + tool orchestration
│       └── admin/route.ts     # CRUD API for any table
├── components/ui/*            # shadcn components
├── lib/
│   ├── clinic.db              # Main SQLite database
│   └── utils.ts               # Helper (e.g., MCP client wrappers)
├── .env.local                 # GEMINI_API_KEY etc.
├── README.md                  # You are here
└── package.json               # Scripts & deps
````

---

## ⚙️ Quick Start

```bash
# 1. Clone & install
git clone <repo-url> heal-ai
cd heal-ai
npm install

# 2. Environment variables (.env.local)
GEMINI_API_KEY=your_key_here

# 3. Run dev server
npm run dev
# open http://localhost:3000
```

SQLite DB (`lib/clinic.db`) ships with sample patients, doctors, visits & queue data. Edit via Admin dashboard at `/admin`.

---

## 🤖 Custom Tools

| Tool                        | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| **`patient_search_tool`**   | Fuzzy find patient by `ic_number`, `passport_number`, or `full_name`.           |
| **`register_patient_tool`** | Register a new patient, ensuring no duplicates and defaults race to **Other**.  |
| **`log_visit_tool`**        | Log a new visit for the patient.                                                |
| **`assign_queue_tool`**     | Create a queue row with an auto-generated number (KL###).                       |
| *(MCP tools)*               | `list_tables`, `describe_table`, `read_query`, `write_query` for DB operations. |

These tools are merged at runtime and supplied to Gemini for function execution.

---

## 🧠 Conversation Memory & Error Handling

1. All outputs (success or error) are injected back into the chat history and frontend (`toolOutputs[]`).
2. If data is missing, the AI politely asks only for the required fields and retries.
3. The backend auto-patches any issues with `describe_table`.

---

## 💼 Business Impact

HEAL.ai aims to be a game-changer for the Malaysian public health system by reducing the burden on healthcare staff while improving patient care. It streamlines the intake process, allowing clinic staff to focus on more critical tasks, all while ensuring that doctors have accurate and organized patient information at their fingertips.

By addressing language barriers and minimizing administrative workload, HEAL.ai can reduce operational costs for government healthcare facilities. Its multilingual capabilities also allow it to cater to diverse communities, making healthcare more accessible to all.

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
 
