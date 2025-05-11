"use client";

import { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Send,
  User,
  Loader2,
  Wrench,
  ChevronDown,
  ChevronUp,
  FileText,
  CheckCircle,
  Circle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import ChatInputWithAudio from '@/app/ChatInputWithAudio';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

// Message type
type Sender = 'user' | 'ai' | 'model';
interface Message {
  sender: Sender;
  text: string;
  functionCall?: { name: string; args: Record<string, any> };
  toolInfo?: {
    toolUsed: boolean;
    toolCalls: number;
    toolName?: string;
    toolOutput?: string;
    toolOutputs?: string[];
  };
}

const steps = [
  { label: 'Triage', key: 'triage' },
  { label: 'Search', key: 'search' },
  { label: 'Registration', key: 'registration' },
  { label: 'Visit', key: 'visit' },
  { label: 'Queue', key: 'queue' },
];

export default function HealAI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showArtifact, setShowArtifact] = useState<Record<number, boolean>>({});
  const [showRegModal, setShowRegModal] = useState(false);
  const [regForm, setRegForm] = useState({ name: '', phone: '', address: '' });
  const [currentStep, setCurrentStep] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Welcome
  useEffect(() => {
    setTimeout(() => {
      setMessages([{ sender: 'ai', text: 'welcome to heal.ai. how may i help you today?' }]);
    }, 500);
  }, []);

  // Scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Stepper logic
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1].text;
    if (/triage/i.test(last)) setCurrentStep(0);
    else if (/ic|passport|search/i.test(last)) setCurrentStep(1);
    else if (/register|registration|phone|address/i.test(last)) setCurrentStep(2);
    else if (/visit|complaint|duration/i.test(last)) setCurrentStep(3);
    else if (/queue|giliran|KL\d{3}/i.test(last)) setCurrentStep(4);
  }, [messages]);

  // Core API call
  const callApi = async (history: any[]) => {
    setIsLoading(true);
    // placeholder
    setMessages(prev => [...prev, { sender: 'ai', text: 'thinking...' }]);
    try {
      const res = await fetch('/api/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
      });
      const data = await res.json();
      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          sender: 'ai',
          text: data.result,
          toolInfo: data.toolUsed
            ? {
                toolUsed: data.toolUsed,
                toolCalls: data.toolCalls,
                toolName: data.toolName,
                toolOutput: data.toolOutput,
                toolOutputs: data.toolOutputs,
              }
            : undefined,
        },
      ]);
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { sender: 'ai', text: 'sorry, i could not get a response right now.' },
      ]);
    }
    setIsLoading(false);
  };

  // Text send
  const handleSendText = (text: string) => {
    const msg = { sender: 'user', text };
    const history = [...messages, msg];
    setMessages(history);
    callApi(history);
  };

  // Audio send
  const handleSubmitAudio = (base64: string, mimeType: string) => {
    const call = {
      sender: 'model' as Sender,
      text: '',
      functionCall: { name: 'speech_to_text', args: { audio: base64, mime_type: mimeType } },
    };
    const history = [...messages, call];
    setMessages(history);
    callApi(history);
  };

  // Registration form
  const handleRegSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowRegModal(false);
    const msg = {
      sender: 'user' as Sender,
      text: `registration info: name: ${regForm.name}, phone: ${regForm.phone}, address: ${regForm.address}`,
    };
    const history = [...messages, msg];
    setMessages(history);
    setRegForm({ name: '', phone: '', address: '' });
    callApi(history);
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-green-50 to-white">
      {/* Stepper */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          {steps.map((s, i) => (
            <div key={s.key} className="flex flex-col items-center flex-1">
              <div
                className={`rounded-full flex items-center justify-center ${
                  i < currentStep
                    ? 'bg-green-500'
                    : i === currentStep
                    ? 'bg-green-300'
                    : 'bg-gray-200'
                } text-white`}
                style={{ width: 40, height: 40, fontSize: 24 }}
              >
                {i < currentStep ? <CheckCircle size={28} /> : <Circle size={28} />}
              </div>
              <span className={`mt-2 text-lg ${i === currentStep ? 'font-bold text-green-700' : 'text-gray-400'}`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Header */}
      <header className="flex items-center justify-center py-8 shadow-sm bg-white sticky top-0 z-10">
        <span className="text-4xl font-bold text-green-600 flex items-center gap-3">
          <User className="text-green-500" size={40} />
          HEAL<span className="text-black">.ai</span>
        </span>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-8 py-10 bg-gradient-to-b from-green-50 via-white to-gray-100 border-t border-b border-gray-200">
        {messages.map((m, idx) => (
          <div key={idx} className={`mb-10 flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="flex items-end gap-2 max-w-3xl">
              {m.sender === 'ai' && <User className="text-green-500 bg-green-100 rounded-full p-2" size={36} />}
              <div
                className={`rounded-3xl px-8 py-6 text-2xl leading-relaxed tracking-wide ${
                  m.sender === 'user' ? 'bg-green-500 text-white' : 'bg-white text-black border border-gray-200'
                }`}
                style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.04)', maxWidth: '80%' }}
              >
                {m.sender === 'ai' ? (
                  <ReactMarkdown className="prose prose-lg prose-green break-words">{m.text}</ReactMarkdown>
                ) : (
                  <span className="font-bold">{m.text}</span>
                )}

                {/* Tool info */}
                {m.sender === 'ai' && m.toolInfo?.toolUsed && (
                  <div className="flex flex-col gap-1 mt-2">
                    <div className="flex items-center gap-2 text-xs text-green-700">
                      <Wrench size={16} className="animate-bounce" />
                      <span>
                        AI used <b>{m.toolInfo.toolName}</b> {m.toolInfo.toolCalls}{' '}
                        {m.toolInfo.toolCalls > 1 ? 'times' : 'once'}.
                      </span>
                      <button
                        onClick={() => setShowArtifact(prev => ({ ...prev, [idx]: !prev[idx] }))}
                        className="ml-2 flex items-center gap-1 px-2 py-1 rounded bg-green-100 text-green-700"
                      >
                        <FileText size={14} />
                        {showArtifact[idx] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {showArtifact[idx] ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {showArtifact[idx] && (
                      <pre className="bg-gray-50 border border-green-200 rounded p-4 text-sm overflow-auto whitespace-pre-wrap font-mono">
                        {(m.toolInfo.toolOutputs || [m.toolInfo.toolOutput]).join('\n\n')}
                      </pre>
                    )}
                  </div>
                )}
              </div>
              {m.sender === 'user' && <User className="text-white bg-green-500 rounded-full p-2" size={36} />}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInputWithAudio onSubmitText={handleSendText} onSubmitAudio={handleSubmitAudio} />

      {/* Registration Modal */}
      <Dialog open={showRegModal} onOpenChange={setShowRegModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Patient Registration</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRegSubmit} className="flex flex-col gap-4">
            <Label htmlFor="reg-name">Full Name</Label>
            <Input id="reg-name" required value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))} />
            <Label htmlFor="reg-phone">Phone</Label>
            <Input id="reg-phone" required value={regForm.phone} onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))} />
            <Label htmlFor="reg-address">Address</Label>
            <Input id="reg-address" required value={regForm.address} onChange={e => setRegForm(f => ({ ...f, address: e.target.value }))} />
            <DialogFooter className="flex gap-2 mt-2">
              <Button type="submit" className="flex-1">Submit</Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowRegModal(false)}>Cancel</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
