"use client";

import { useState, useEffect, useRef } from 'react';
import { Mic, Send, User, Loader2, Wrench, ChevronDown, ChevronUp, FileText, CheckCircle, Circle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

// Define the Message type
interface Message {
  sender: 'user' | 'ai';
  text: string;
  toolInfo?: {
    toolUsed: boolean;
    toolCalls: number;
    toolName?: string;
    toolOutput?: string;
    toolOutputs?: string[];
  };
}

interface ToolArtifact {
  toolName: string;
  toolOutput: string;
}

const steps = [
  { label: "Triage", key: "triage" },
  { label: "Search", key: "search" },
  { label: "Registration", key: "registration" },
  { label: "Visit", key: "visit" },
  { label: "Queue", key: "queue" },
];

export default function HealAI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showArtifact, setShowArtifact] = useState<{ [key: number]: boolean }>({});
  const [fetchedContents, setFetchedContents] = useState<{ url: string, content: string }[]>([]);
  const [showRegModal, setShowRegModal] = useState(false);
  const [regForm, setRegForm] = useState({ name: '', phone: '', address: '' });
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [triageLevel, setTriageLevel] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [regError, setRegError] = useState<string | null>(null);

  useEffect(() => {
    setTimeout(() => {
      setMessages([{ sender: 'ai', text: 'welcome to heal.ai. how may i help you today?' }]);
    }, 500);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Detect phase from AI messages and update progress bar
  useEffect(() => {
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (/triage/i.test(last.text)) setCurrentStep(0);
      else if (/ic|passport|search/i.test(last.text)) setCurrentStep(1);
      else if (/register|registration|full name|phone|address/i.test(last.text)) setCurrentStep(2);
      else if (/visit|complaint|duration/i.test(last.text)) setCurrentStep(3);
      else if (/queue|giliran|KL\d{3}/i.test(last.text)) setCurrentStep(4);
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage: Message = { sender: 'user', text: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Clear memory if user requests
    if (input.trim().toLowerCase() === 'clear memory') {
      setFetchedContents([]);
    }

    // Build history: inject all fetched contents before the new user message
    let history: Message[] = [...messages];
    if (fetchedContents.length > 0) {
      fetchedContents.forEach(fc => {
        history.push({ sender: 'user', text: fc.content });
      });
    }
    history.push({ sender: 'user', text: input.trim() });

    setMessages(prev => [...prev, { sender: 'ai', text: 'thinking...' }]);
    try {
      const res = await fetch('/api/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
      });
      const data = await res.json();
      const aiMessage: Message = {
        sender: 'ai',
        text: data.result,
        toolInfo: data.toolUsed
          ? {
              toolUsed: !!data.toolUsed,
              toolCalls: data.toolCalls || 0,
              toolName: data.toolName || (data.toolUsed ? 'fetch' : undefined),
              toolOutput: data.toolOutput || data.fetchedContent || undefined,
              toolOutputs: data.toolOutputs || undefined
            }
          : undefined
      };
      setMessages(prev => [
        ...prev.slice(0, -1),
        aiMessage
      ]);
      if (data.toolOutput && (data.toolName === 'fetch' || (!data.toolName && data.toolUsed))) {
        const match = data.toolOutput.match(/Here is the content from (.+?):\n([\s\S]*)/);
        if (match) {
          setFetchedContents(prev => [...prev, { url: match[1], content: data.toolOutput }]);
        }
      }
    } catch (err) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { sender: 'ai', text: 'sorry, i could not get a response right now.' }
      ]);
    }
    setIsLoading(false);
  };

  const handleRegSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowRegModal(false);
    setInput('');
    // Send as a structured user message
    const userMessage: Message = {
      sender: 'user',
      text: `Registration info: Name: ${regForm.name}, Phone: ${regForm.phone}, Address: ${regForm.address}`
    };
    setMessages(prev => [...prev, userMessage]);
    setRegForm({ name: '', phone: '', address: '' });
    setIsLoading(true);
    // Build history: inject all fetched contents before the new user message
    let history: Message[] = [...messages];
    if (fetchedContents.length > 0) {
      fetchedContents.forEach(fc => {
        history.push({ sender: 'user', text: fc.content });
      });
    }
    history.push(userMessage);
    setMessages(prev => [...prev, { sender: 'ai', text: 'Thinking...' }]);
    fetch('/api/general', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history }),
    })
      .then(res => res.json())
      .then(data => {
        const aiMessage: Message = {
          sender: 'ai',
          text: data.result,
          toolInfo: data.toolUsed
            ? {
                toolUsed: !!data.toolUsed,
                toolCalls: data.toolCalls || 0,
                toolName: data.toolName || (data.toolUsed ? 'fetch' : undefined),
                toolOutput: data.toolOutput || data.fetchedContent || undefined,
                toolOutputs: data.toolOutputs || undefined
              }
            : undefined
        };
        setMessages(prev => [
          ...prev.slice(0, -1),
          aiMessage
        ]);
        if (data.toolOutput && (data.toolName === 'fetch' || (!data.toolName && data.toolUsed))) {
          const match = data.toolOutput.match(/Here is the content from (.+?):\n([\s\S]*)/);
          if (match) {
            setFetchedContents(prev => [...prev, { url: match[1], content: data.toolOutput }]);
          }
        }
      })
      .catch(() => {
        setMessages(prev => [
          ...prev.slice(0, -1),
          { sender: 'ai', text: 'Sorry, I could not get a response right now.' }
        ]);
      })
      .finally(() => setIsLoading(false));
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-green-50 to-white">
      {/* Progress Bar / Stepper */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          {steps.map((step, i) => (
            <div key={step.key} className="flex flex-col items-center flex-1">
              <div className={`rounded-full flex items-center justify-center ${i < currentStep ? 'bg-green-500' : i === currentStep ? 'bg-green-300' : 'bg-gray-200'} text-white`} style={{ width: 40, height: 40, fontSize: 24 }}>
                {i < currentStep ? <CheckCircle size={28} /> : <Circle size={28} />}
              </div>
              <span className={`mt-2 text-lg ${i === currentStep ? 'font-bold text-green-700' : 'text-gray-400'}`}>{step.label}</span>
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
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-10 flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
          >
            {/* Only wrap bubble and icon together, not full width */}
            <div className={`flex items-end gap-2`} style={{ maxWidth: '80%', alignItems: 'center' }}>
              {/* AI icon left, user icon right, both close to bubble */}
              {msg.sender === 'ai' && (
                <User className="text-green-500 bg-green-100 rounded-full p-2" size={36} />
              )}
              <div
                className={`rounded-3xl px-8 py-6 max-w-2xl text-2xl leading-relaxed tracking-wide
                  ${msg.sender === 'user'
                    ? 'bg-green-500 text-white'
                    : 'bg-white text-black border border-gray-200'}
                `}
                style={{ boxShadow: '0 2px 12px 0 rgba(0,0,0,0.04)' }}
              >
                {msg.sender === 'ai' ? (
                  <div className="prose prose-lg prose-green max-w-2xl break-words">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                    {/* Highlight triage status if present */}
                    {/urgent|red|emergency/i.test(msg.text) && (
                      <Badge variant="destructive" className="ml-2">URGENT</Badge>
                    )}
                    {/queue number|giliran|KL\d{3}/i.test(msg.text) && (
                      <div className="mt-2">
                        <Card className="bg-green-50 border-green-300 text-center p-4">
                          <div className="text-lg font-bold text-green-700">Queue Number</div>
                          <div className="text-3xl font-extrabold text-green-900">{msg.text.match(/KL\d{3}/)?.[0]}</div>
                        </Card>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="font-bold">{msg.text}</span>
                )}
                {/* Tool info and artifact for this AI message */}
                {msg.sender === 'ai' && msg.toolInfo?.toolUsed && (
                  <div className="flex flex-col gap-1 mt-2 animate-fade-in">
                    <div className="flex items-center gap-2 text-xs text-green-700">
                      <Wrench size={16} className="animate-bounce" />
                      <span>
                        AI used the <b>{msg.toolInfo.toolName || 'fetch'}</b> tool {msg.toolInfo.toolCalls > 1 ? `${msg.toolInfo.toolCalls} times` : 'once'} to answer this.
                      </span>
                      <button
                        className="ml-2 flex items-center gap-1 px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 hover:shadow-md transition"
                        onClick={() => setShowArtifact(prev => ({ ...prev, [i]: !prev[i] }))}
                      >
                        <FileText size={14} />
                        {showArtifact[i] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        <span>{showArtifact[i] ? 'Hide' : 'Show'} tool output</span>
                      </button>
                    </div>
                    {showArtifact[i] && (
                      <div className="bg-gray-50 border border-green-200 rounded p-4 text-sm max-h-80 overflow-auto whitespace-pre-wrap mt-2 shadow-inner font-mono space-y-4">
                        {(msg.toolInfo.toolOutputs || [msg.toolInfo.toolOutput]).map((out, idx) => (
                          <div key={idx}>
                            <div className="text-xs text-green-600 mb-1">Output #{idx + 1}</div>
                            {(() => {
                              try {
                                const json = JSON.parse(out as string);
                                return <pre>{JSON.stringify(json, null, 2)}</pre>;
                              } catch {
                                return (
                                  <pre className={/error|missing/i.test(out ?? '') ? 'text-red-600' : ''}>{out}</pre>
                                );
                              }
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {msg.sender === 'user' && (
                <User className="text-white bg-green-500 rounded-full p-2" size={36} />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-8 bg-white border-t flex items-center sticky bottom-0 shadow-lg z-20 rounded-b-3xl">
        <input
          ref={inputRef}
          className="flex-1 rounded-3xl px-6 py-4 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-400 shadow-sm bg-gray-50 text-2xl"
          placeholder="type your message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          disabled={isLoading}
        />
        <button
          className="ml-6 bg-green-500 p-4 rounded-full text-white hover:bg-green-600 disabled:opacity-50 shadow text-2xl"
          onClick={handleSend}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="animate-spin" size={28} /> : <Send size={28} />}
        </button>
      </div>

      {/* Registration Modal */}
      <Dialog open={showRegModal} onOpenChange={setShowRegModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Patient Registration</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRegSubmit} className="flex flex-col gap-4">
            <Label htmlFor="reg-name">Full Name</Label>
            <Input id="reg-name" required value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))} placeholder="Full Name" />
            <Label htmlFor="reg-phone">Phone Number</Label>
            <Input id="reg-phone" required value={regForm.phone} onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone Number" />
            <Label htmlFor="reg-address">Address</Label>
            <Input id="reg-address" required value={regForm.address} onChange={e => setRegForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" />
            <DialogFooter className="flex gap-2 mt-2">
              <Button type="submit" className="flex-1">Submit</Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowRegModal(false)}>Cancel</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add error/validation message display for registration step */}
      {regError && <div className="text-red-600 text-lg font-bold mb-4">{regError}</div>}

      <style jsx global>{`
        .animate-fade-in {
          animation: fadeIn 0.4s;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .prose-green a {
          color: #16a34a;
        }
        .prose {
          word-break: break-word;
        }
        .bg-gradient-to-b {
          background: linear-gradient(to bottom, #f0fdf4 0%, #fff 60%, #f3f4f6 100%);
        }
      `}</style>
    </div>
  );
}
