"use client";

import { useState, useEffect, useRef } from 'react';
import { Mic, Send, User, Loader2, Wrench, ChevronDown, ChevronUp, FileText, CheckCircle, Circle, MicOff, AlertTriangle } from 'lucide-react';
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const emergencySoundRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const resetChat = () => {
    setMessages([{ sender: 'ai', text: 'welcome to heal.ai. how may i help you today?' }]);
    setTriageLevel(null);
    setCurrentStep(0);
    setFetchedContents([]);
    setShowEmergencyModal(false);
  };

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

  useEffect(() => {
    // Initialize audio context
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }, []);

  const playEmergencySound = () => {
    if (!audioContextRef.current) return;
    
    const audioContext = audioContextRef.current;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // Configure the oscillator for a siren-like sound
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.5); // A4 note
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 1); // Back to A5
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 1.5); // Back to A4

    // Configure the gain node
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // Lower volume
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + 0.5);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + 1);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + 1.5);

    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Start and stop the sound
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 2); // 2 seconds duration
  };

  const handleEmergencyTriage = (triageLevel: string) => {
    if (triageLevel === 'Red') {
      // Play emergency sound
      playEmergencySound();
      // Show emergency modal
      setShowEmergencyModal(true);
    }
  };

  const handleSend = async (audioBlob?: Blob) => {
    if (!input.trim() && !audioBlob) return;

    const userMessageText = input.trim();
    const displayMessageText = audioBlob ? (userMessageText ? `${userMessageText} [Audio sent]` : "[Audio Input]") : userMessageText;
    setMessages(prev => [...prev, { sender: 'user', text: displayMessageText }]);
    setInput('');
    setIsLoading(true);

    let historyForApi: Message[] = [...messages];
    if (fetchedContents.length > 0) {
      fetchedContents.forEach(fc => {
        historyForApi.push({ sender: 'user', text: fc.content });
      });
    }
    if (userMessageText) {
      historyForApi.push({ sender: 'user', text: userMessageText });
    }

    setMessages(prev => [...prev, { sender: 'ai', text: 'thinking...' }]);

    const formData = new FormData();
    formData.append('history', JSON.stringify(historyForApi));
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
      
      // Handle tool outputs
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

      // Check for queue tool output and create separate message if found
      const messagesToAdd = [aiMessage];
      if (data.toolOutput) {
        try {
          const json = JSON.parse(data.toolOutput);
          if (json.queue_number && json.doctor_name) {
            messagesToAdd.push({
              sender: 'ai',
              text: '',
              toolInfo: {
                toolUsed: true,
                toolCalls: 1,
                toolName: 'queue_tool',
                toolOutput: data.toolOutput
              }
            });
          }
        } catch (e) {
          console.error('Error parsing tool output:', e);
        }
      }

      setMessages(prev => [
        ...prev.slice(0, -1), // Remove "thinking..."
        ...messagesToAdd
      ]);
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

  useEffect(() => {
    if (messages.length > 0) {
      const lastAiMessage = messages.filter(m => m.sender === 'ai').pop();
      if (
        lastAiMessage &&
        lastAiMessage.toolInfo?.toolUsed &&
        lastAiMessage.toolInfo.toolOutput
      ) {
        const toolName = lastAiMessage.toolInfo.toolName?.toLowerCase() || '';
        let isTriageTool = toolName.includes('triage');
        let triageValue: string | null = null;
        try {
          let output = lastAiMessage.toolInfo.toolOutput;
          if (typeof output === 'string') {
            // Extract JSON part if there's a prefix
            const jsonStart = output.indexOf('{');
            const jsonEnd = output.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
              output = output.substring(jsonStart, jsonEnd + 1);
            }
          }
          const triageObj = JSON.parse(output);
          if (triageObj.triage) {
            triageValue = triageObj.triage.charAt(0).toUpperCase() + triageObj.triage.slice(1).toLowerCase();
            isTriageTool = true;
          }
        } catch (e) {
          // Ignore parse errors
        }
        if (isTriageTool && triageValue) {
          setTriageLevel(triageValue);
          if (triageValue === 'Red') {
            handleEmergencyTriage(triageValue);
          }
        }
      }
    }
  }, [messages]);

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
                triageLevel.toLowerCase() === "red" ? "bg-red-500 hover:bg-red-600" :
                triageLevel.toLowerCase() === "yellow" ? "bg-yellow-400 hover:bg-yellow-500 text-neutral-800" :
                triageLevel.toLowerCase() === "green" ? "bg-green-500 hover:bg-green-600" :
                triageLevel.toLowerCase() === "blue" ? "bg-blue-500 hover:bg-blue-600" :
                "bg-gray-500 hover:bg-gray-600"
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
            <div className={`flex items-end gap-2`} style={{ maxWidth: '80%', alignItems: 'center' }}>
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
                    {msg.text && <ReactMarkdown>{msg.text}</ReactMarkdown>}
                    {msg.toolInfo?.toolUsed && msg.toolInfo.toolName === 'queue_tool' && !msg.text && (() => {
                      try {
                        const json = JSON.parse(msg.toolInfo.toolOutput || '{}');
                        if (json.queue_number && json.doctor_name) {
                          return (
                            <Card className="bg-white border-2 border-green-200 shadow-lg animate-fade-in">
                              <div className="p-6 text-center space-y-4">
                                <div className="text-4xl font-bold text-green-600 animate-pulse">{json.queue_number}</div>
                                <div className="text-lg text-gray-600">Assigned to {json.doctor_name}</div>
                                <div className="text-sm text-gray-500">Please wait in the waiting area</div>
                              </div>
                            </Card>
                          );
                        }
                      } catch (e) {
                        console.error('Error parsing queue tool output:', e);
                      }
                      return null;
                    })()}
                    {msg.toolInfo?.toolUsed && (
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
                            {(msg.toolInfo.toolOutputs || [msg.toolInfo.toolOutput]).map((out, idx) => {
                              try {
                                const json = typeof out === 'string' ? JSON.parse(out) : out;
                                return <pre key={idx}>{JSON.stringify(json, null, 2)}</pre>;
                              } catch (e) {
                                return <pre key={idx}>{out}</pre>;
                              }
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="font-bold">{msg.text}</span>
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
        {/* Simulate Tool Buttons */}
        <div className="ml-6 flex gap-2">
          {/* Simulate triage_tool */}
          <button
            title="Simulate Triage"
            className="bg-red-400 p-3 rounded-full text-white hover:bg-red-500 shadow"
            onClick={() => {
              setMessages(prev => [...prev, {
                sender: 'ai',
                text: 'Based on your symptoms, you are classified as yellow triage. Please wait for further instructions.',
                toolInfo: {
                  toolUsed: true,
                  toolCalls: 1,
                  toolName: 'triage_tool',
                  toolOutput: JSON.stringify({ triage: 'yellow', logic: 'Patient has moderate symptoms, not life-threatening.' })
                }
              }]);
              setTriageLevel('Yellow');
            }}
            disabled={isLoading || isRecording}
          >Triage</button>
          {/* Simulate search_tool */}
          <button
            title="Simulate Search"
            className="bg-blue-400 p-3 rounded-full text-white hover:bg-blue-500 shadow"
            onClick={() => setMessages(prev => [...prev, {
              sender: 'ai',
              text: 'Patient found in the system.',
              toolInfo: {
                toolUsed: true,
                toolCalls: 1,
                toolName: 'search_tool',
                toolOutput: JSON.stringify({ status: 'found', patient: { id: 1, full_name: 'Syamil', ic_number: '900101-01-1234' } })
              }
            }])}
            disabled={isLoading || isRecording}
          >Search</button>
          {/* Simulate register_tool */}
          <button
            title="Simulate Register"
            className="bg-green-400 p-3 rounded-full text-white hover:bg-green-500 shadow"
            onClick={() => setMessages(prev => [...prev, {
              sender: 'ai',
              text: 'Registration successful. Welcome, Syamil!',
              toolInfo: {
                toolUsed: true,
                toolCalls: 1,
                toolName: 'register_tool',
                toolOutput: JSON.stringify({ status: 'registered', patient_id: 1 })
              }
            }])}
            disabled={isLoading || isRecording}
          >Register</button>
          {/* Simulate queue_tool */}
          <button
            title="Simulate Queue"
            className="bg-purple-400 p-3 rounded-full text-white hover:bg-purple-500 shadow"
            onClick={() => {
              const testQueue = {
                queue_number: `Q${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
                doctor_id: 3,
                doctor_name: 'Dr. Rajesh Kumar',
                queue_id: Math.floor(Math.random() * 100) + 1
              };
              setMessages(prev => [
                ...prev,
                {
                  sender: 'ai',
                  text: 'Your queue number is ' + testQueue.queue_number + '. Please wait for ' + testQueue.doctor_name + ' to call you.',
                  toolInfo: {
                    toolUsed: true,
                    toolCalls: 1,
                    toolName: 'queue_tool',
                    toolOutput: JSON.stringify(testQueue)
                  }
                },
                {
                  sender: 'ai',
                  text: '',
                  toolInfo: {
                    toolUsed: true,
                    toolCalls: 1,
                    toolName: 'queue_tool',
                    toolOutput: JSON.stringify(testQueue)
                  }
                }
              ]);
            }}
            disabled={isLoading || isRecording}
          >Queue</button>
          {/* Simulate summary_tool */}
          <button
            title="Simulate Summary"
            className="bg-yellow-400 p-3 rounded-full text-white hover:bg-yellow-500 shadow"
            onClick={() => setMessages(prev => [...prev, {
              sender: 'ai',
              text: 'Summary recorded for this visit.',
              toolInfo: {
                toolUsed: true,
                toolCalls: 1,
                toolName: 'summary_tool',
                toolOutput: JSON.stringify({ status: 'recorded', summary: 'Patient presented with cough and fever. Triage: yellow.' })
              }
            }])}
            disabled={isLoading || isRecording}
          >Summary</button>
          {/* Simulate feedback_tool */}
          <button
            title="Simulate Feedback"
            className="bg-pink-400 p-3 rounded-full text-white hover:bg-pink-500 shadow"
            onClick={() => setMessages(prev => [...prev, {
              sender: 'ai',
              text: 'Thank you for your feedback!',
              toolInfo: {
                toolUsed: true,
                toolCalls: 1,
                toolName: 'feedback_tool',
                toolOutput: JSON.stringify({ status: 'recorded' })
              }
            }])}
            disabled={isLoading || isRecording}
          >Feedback</button>
        </div>
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

      {/* Emergency Modal */}
      <Dialog open={showEmergencyModal} onOpenChange={setShowEmergencyModal}>
        <DialogContent className="sm:max-w-md bg-red-50 border-red-200">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-6 w-6" />
              Emergency Alert - Critical Triage
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="text-center space-y-4">
              <div className="text-2xl font-bold text-red-600">
                🚨 EMERGENCY 🚨
              </div>
              <p className="text-lg">
                Patient requires immediate medical attention.
                <br />
                Nurse has been notified and is on the way.
              </p>
              <div className="animate-pulse text-red-500 font-semibold">
                Please remain calm and seated.
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              className="w-full"
              onClick={resetChat}
            >
              Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        .animate-fade-in {
          animation: fadeIn 0.4s;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
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
