"use client";

import { useState, useEffect, useRef } from 'react';
import { Mic, Send, User, Loader2, Wrench, ChevronDown, ChevronUp, FileText, CheckCircle, Circle, MicOff } from 'lucide-react';
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
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setTimeout(() => {
      setMessages([{ sender: 'ai', text: 'welcome to heal.ai. how may i help you today?' }]);
    }, 500);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Remove regex-based triage detection from useEffect
  useEffect(() => {
    if (messages.length > 0) {
      const lastAiMessage = messages.filter(m => m.sender === 'ai').pop();
      if (lastAiMessage) {
        const text = lastAiMessage.text.toLowerCase();
        if (/triage/i.test(text) || /how may i help/i.test(text) || /symptom/i.test(text)) setCurrentStep(0);
        else if (/ic|passport|search/i.test(text) || /your name/i.test(text)) setCurrentStep(1);
        else if (/register|registration|full name|phone|address/i.test(text)) setCurrentStep(2);
        else if (/visit|complaint|duration|doctor/i.test(text)) setCurrentStep(3);
        else if (/queue|giliran|kl\\d{3}/i.test(text)) setCurrentStep(4);
        // triageLevel is now set only when triage_tool is called (see handleSend)
      }
    }
  }, [messages]);

  const handleSend = async (audioBlob?: Blob) => {
    if (!input.trim() && !audioBlob) return;

    const userMessageText = input.trim();
    // Display [Audio Input] if audio is present, otherwise the typed text.
    const displayMessageText = audioBlob ? (userMessageText ? `${userMessageText} [Audio sent]` : "[Audio Input]") : userMessageText;
    setMessages(prev => [...prev, { sender: 'user', text: displayMessageText }]);
    setInput('');
    setIsLoading(true);

    // Clear memory if user requests (text command)
    if (userMessageText.toLowerCase() === 'clear memory') {
      setFetchedContents([]);
    }

    let historyForApi: Message[] = [...messages]; // Current messages before adding new one
    if (fetchedContents.length > 0) {
      fetchedContents.forEach(fc => {
        historyForApi.push({ sender: 'user', text: fc.content });
      });
    }
     // Add the current user text to historyForApi for context, even if audio is present.
     // The backend will use the audio for transcription, but text can be kept for record if desired.
    if (userMessageText) {
        historyForApi.push({ sender: 'user', text: userMessageText });
    }

    setMessages(prev => [...prev, { sender: 'ai', text: 'thinking...' }]);

    const formData = new FormData();
    // Send the history *before* the current message that might be audio.
    // The backend will add the transcribed audio/text as the latest user message.
    formData.append('history', JSON.stringify(historyForApi)); 
    
    // If there's text input, send it. Backend decides if it uses this or audio.
    if (userMessageText) {
        formData.append('input', userMessageText);
    }
    if (audioBlob) {
      formData.append('audio', audioBlob, `user_audio_${Date.now()}.webm`);
    }

    try {
      const res = await fetch('/api/general', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      // If triageLevel is present in response, set it
      if (data.triageLevel) {
        setTriageLevel(
          data.triageLevel === 'red' ? 'Red' :
          data.triageLevel === 'yellow' ? 'Yellow' :
          data.triageLevel === 'green' ? 'Green' : null
        );
      }
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
        ...prev.slice(0, -1), // Remove "thinking..."
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
        ...prev.slice(0, -1), // Remove "thinking..."
        { sender: 'ai', text: 'sorry, i could not get a response right now.' }
      ]);
    }
    setIsLoading(false);
  };

  const handleRegSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowRegModal(false);
    setInput('');

    const regDetails = `Registration info: Name: ${regForm.name}, Phone: ${regForm.phone}, Address: ${regForm.address}`;
    const userMessage: Message = { sender: 'user', text: regDetails };
    // Add to messages for display
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setRegForm({ name: '', phone: '', address: '' });
    setIsLoading(true);

    let historyForApi: Message[] = [...newMessages.slice(0,-1)]; // History before the registration message itself
    if (fetchedContents.length > 0) {
      fetchedContents.forEach(fc => {
        historyForApi.push({ sender: 'user', text: fc.content });
      });
    }
    // The regDetails will be the current user input for this turn

    setMessages(prev => [...prev, { sender: 'ai', text: 'Thinking...' }]);

    const formData = new FormData();
    formData.append('history', JSON.stringify(historyForApi));
    formData.append('input', regDetails); // Send registration details as the current input

    fetch('/api/general', {
      method: 'POST',
      body: formData,
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
          ...prev.slice(0, -1), // Remove "Thinking..."
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
          ...prev.slice(0, -1), // Remove "Thinking..."
          { sender: 'ai', text: 'Sorry, I could not get a response right now.' }
        ]);
      })
      .finally(() => setIsLoading(false));
  };

  const startRecording = async () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        const supportedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));

        if (!supportedMimeType) {
          setMessages(prev => [...prev, {sender: 'ai', text: 'sorry, no supported audio format found for recording.'}]);
          setIsRecording(false);
          return;
        }
        console.log("Using MIME type:", supportedMimeType);
        mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: supportedMimeType });
        audioChunksRef.current = [];

        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorderRef.current.onstop = () => {
          setIsRecording(false); // Set recording to false when stopped
          if (audioChunksRef.current.length > 0) {
            const audioBlob = new Blob(audioChunksRef.current, { type: supportedMimeType });
            console.log("Audio blob created, size:", audioBlob.size);
            handleSend(audioBlob); // Send the recorded audio
          } else {
            console.log("No audio chunks recorded.");
            // If no audio data was captured, and there was text input, send text input.
            if (input.trim()) {
                handleSend(); 
            } else {
                // Optionally, inform user no audio was captured if input is also empty
                // setMessages(prev => [...prev, {sender: 'ai', text: 'no audio was recorded. type your message or try recording again.'}]);
            }
          }
          stream.getTracks().forEach(track => track.stop()); // Clean up stream tracks
          audioChunksRef.current = []; // Clear chunks for next recording
        };

        mediaRecorderRef.current.onerror = (event: Event) => {
            console.error("MediaRecorder error:", event);
            setIsRecording(false);
            setMessages(prev => [...prev, {sender: 'ai', text: `sorry, an error occurred during recording: ${(event as any).error?.message || 'Unknown error'}.`}]);
            stream.getTracks().forEach(track => track.stop());
            audioChunksRef.current = [];
        };

        mediaRecorderRef.current.start();
        setIsRecording(true);
        setInput(''); // Clear text input when starting voice recording
      } catch (err: any) {
        console.error("Error accessing microphone:", err);
        setIsRecording(false);
        let errMsg = 'sorry, i could not access your microphone. please check permissions and try again, or type your message.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            errMsg = "microphone access was denied. please enable it in your browser settings.";
        } else if (err.name === 'NotFoundError') {
            errMsg = "no microphone found. please ensure one is connected and enabled.";
        } else if (err.name === 'NotReadableError') {
            errMsg = "microphone is already in use or not readable. please check other applications.";
        }
        setMessages(prev => [...prev, {sender: 'ai', text: errMsg}]);
      }
    } else {
       setMessages(prev => [...prev, {sender: 'ai', text: 'sorry, audio recording is not supported on your browser.'}]);
       setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    // setIsRecording(false); // This is now primarily handled in onstop or error callbacks for accuracy
    // However, if the user clicks to stop and for some reason onstop isn't immediate, this provides quicker UI feedback.
    if (isRecording) setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
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
        {/* Display Triage Level */}
        {triageLevel && (
          <div className="text-center mb-2 py-2">
            <Badge 
              className={`text-base px-3 py-1.5 rounded-md shadow-md ${
                triageLevel === "Red" ? "bg-red-500 hover:bg-red-600" : 
                triageLevel === "Yellow" ? "bg-yellow-400 hover:bg-yellow-500 text-neutral-800" : 
                "bg-green-500 hover:bg-green-600"
              } text-white font-semibold`}
            >
              TRIAGE: {triageLevel.toUpperCase()}
            </Badge>
          </div>
        )}
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
                    {msg.sender === 'ai' && msg.toolInfo?.toolUsed &&
                      msg.toolInfo.toolName &&
                      msg.toolInfo.toolName.toLowerCase() === 'triage_tool' &&
                      triageLevel && (
                        triageLevel === 'Red' ? (
                          <Badge variant="destructive" className="ml-2 my-1">URGENT</Badge>
                        ) : triageLevel === 'Yellow' ? (
                          <Badge className="bg-yellow-400 text-black hover:bg-yellow-500 ml-2 my-1">SEMI-URGENT</Badge>
                        ) : triageLevel === 'Green' ? (
                          <Badge className="bg-green-500 text-white hover:bg-green-600 ml-2 my-1">NON-URGENT</Badge>
                        ) : null
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
          placeholder="type your message or use the mic..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !isRecording && handleSend()}
          disabled={isLoading || isRecording}
        />
        <button
          title={isRecording ? "Stop recording" : "Start recording"}
          className={`ml-4 p-4 rounded-full text-white shadow hover:opacity-80 disabled:opacity-50 transition-colors duration-200 ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-500 hover:bg-blue-600'}`}
          onClick={toggleRecording}
          disabled={isLoading}
        >
          {isRecording ? <MicOff size={28} /> : <Mic size={28} />}
        </button>
        <button
          title="Send message"
          className="ml-6 bg-green-500 p-4 rounded-full text-white hover:bg-green-600 disabled:opacity-50 shadow text-2xl transition-colors duration-200"
          onClick={() => handleSend()}
          disabled={isLoading || isRecording || (!input.trim() && audioChunksRef.current.length === 0)}
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
