# HEAL.ai – Digital Front-Liner for Malaysian Clinics

HEAL.ai is developed by the **UMHackathon** team for the **ELLM Startup Initiative 2025**, a competition organized by **UMSCOM**. Heal.AI is a multilingual, AI-powered virtual receptionist that automates patient intake, understands any local language, and generates structured summaries for doctors in the Malaysian public health context. It reduces clinic staff costs, eliminates language barriers, and streamlines diagnosis by ensuring doctors never need to repeat basic questions.

HEAL.ai is built to function in **Klinik Kesihatan** and **Hospital Kerajaan** settings across Malaysia, providing a seamless experience for both patients and healthcare providers. It triages patients, searches or registers them in the database, logs the visit, auto-assigns a queue number based on doctor availability, and delivers concise visit summaries in **simple Malaysian English** and **Bahasa Malaysia**. This makes it easy to understand for all users, from clinic staff to patients.

---

## 🚀 Key Features

| Step         | What Happens                                                          | Tools Involved              |
|--------------|-----------------------------------------------------------------------|-----------------------------|
| **1. Triage** | AI asks symptoms and follow-up questions in plain language, then calls a dedicated triage_tool for structured triage decision. | triage_tool                 |
| **2. Search**  | AI calls search_tool to look up patients by IC number or passport.      | search_tool                 |
| **3. Register** | If the patient is not found, AI collects all required info and calls register_tool. | register_tool               |
| **4. Queue**    | AI calls queue_tool to assign a queue number and doctor.               | queue_tool                  |
| **5. Summary**  | AI calls summary_tool to generate and store a concise visit summary.   | summary_tool                |
| **6. Feedback** | For blue (routine) cases, AI collects feedback and calls feedback_tool.| feedback_tool               |
| **7. Schema**   | AI uses describe_table and list_tables to dynamically check DB schema. | describe_table, list_tables |

*All tool outputs and AI reasoning are injected into the chat history for full traceability and auditability.*

---

## 🧠 Why Use a Dedicated triage_tool?

- **Explainability & Auditability:** The triage_tool returns a structured JSON with `triage` and `logic`, making every triage decision transparent and reviewable.
- **Modularity:** Triage logic can be updated or replaced independently of the main AI workflow.
- **Clinical Safety:** Ensures guideline-based, consistent triage, and supports regulatory requirements for traceable decision-making.
- **Agent-Orchestrated:** The AI agent (Gemini) orchestrates the workflow, but key clinical decisions are delegated to specialized tools for safety and clarity.

---

## 🧱 Tech Stack

| Layer            | Stack / Library                               |
|------------------|-----------------------------------------------|
| **Frontend**     | **Next.js 15** (App Router) + **TypeScript**  |
| **UI Components**| **shadcn/ui** (Radix + Tailwind)              |
| **Icons**        | **Lucide-react**                              |
| **State / React**| Client components with hooks                  |
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
│   └── tools.ts               # Custom tool implementations
├── .env.local                 # GEMINI_API_KEY etc.
├── README.md                  # You are here
└── package.json               # Scripts & deps
```

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

| Tool            | Purpose                                                                 |
|-----------------|-------------------------------------------------------------------------|
| **triage_tool** | Analyze symptoms and return triage level (red/yellow/green/blue) + logic|
| **search_tool** | Find patient by IC or passport, update last_attended                    |
| **register_tool**| Register a new patient in the clinic                                   |
| **queue_tool**  | Assign queue number & doctor based on triage and availability           |
| **summary_tool**| Generate and store a summary of the patient visit                      |
| **feedback_tool**| Record patient feedback (blue cases)                                   |
| **describe_table**| Show table structure (schema discovery)                               |
| **list_tables** | List all available database tables                                      |

*All tools are orchestrated by the AI agent, and all outputs are injected into the chat history for transparency and debugging.*

---

## 🧠 Conversation Memory & Error Handling

1. All tool outputs and AI reasoning are injected back into the chat history and frontend (`toolOutputs[]`).
2. If data is missing, the AI politely asks only for the required fields and retries.
3. The backend auto-patches any issues with `describe_table`.
4. The system prompt enforces a proactive, stepwise workflow: the AI never waits for 'ok' or 'proceed', and always follows the workflow order based on triage color.

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
📧 sayyidsyamils@gmail.com
📍 Kuala Lumpur, Malaysia
🔗 [LinkedIn](https://www.linkedin.com/in/sayyidsyamil)

Wong Yoong Yee (Backend & Model Developer, Group Leader)
📧 mackwong1@gmail.com
📍 Kuala Lumpur, Malaysia
🔗 [LinkedIn](https://www.linkedin.com/in/mackwongyy)

Chai Jie Sheng (Frontend Developer)
📧 chaijiesheng88@gmail.com
📍 Kuala Lumpur, Malaysia
🔗 [LinkedIn](https://www.linkedin.com/in/chaijiesheng)

Aman Iskandar (Business Advisor)
📧 amaniskandar04@gmail.com
📍 Kuala Lumpur, Malaysia
🔗 [LinkedIn](https://www.linkedin.com/in/aman-iskandar-mohamad-dzulhaidi)
