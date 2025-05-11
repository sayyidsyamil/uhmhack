import React, { useState, useRef } from 'react';
import { Mic, Send } from 'lucide-react';

interface ChatInputProps {
  onSubmitText: (text: string) => void;
  onSubmitAudio: (base64: string, mimeType: string) => void;
}

export default function ChatInputWithAudio({ onSubmitText, onSubmitAudio }: ChatInputProps) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    if (!navigator.mediaDevices) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];
    recorder.ondataavailable = e => audioChunksRef.current.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      setAudioURL(url);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const submitAudio = async () => {
    if (!audioChunksRef.current.length) return;
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = window.btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    onSubmitAudio(base64, blob.type);
    setAudioURL(null);
  };

  return (
    <div className="flex items-center space-x-2 p-2 border-t">
      <button
        onClick={recording ? stopRecording : startRecording}
        className={`p-2 rounded-full focus:outline-none ${recording ? 'bg-red-200' : 'bg-green-200'}`}
        title={recording ? 'Stop recording' : 'Start recording'}
      >
        <Mic size={20} />
      </button>

      {audioURL && (
        <button
          onClick={submitAudio}
          className="p-2 rounded-full bg-blue-200 focus:outline-none"
          title="Send audio"
        >
          <Send size={20} />
        </button>
      )}

      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && text.trim()) {
            onSubmitText(text.trim());
            setText('');
          }
        }}
        placeholder="Type your message…"
        className="flex-1 p-2 border rounded"
      />

      <button
        onClick={() => {
          if (text.trim()) {
            onSubmitText(text.trim());
            setText('');
          }
        }}
        className="p-2 rounded-full bg-blue-200 focus:outline-none"
        title="Send text"
      >
        <Send size={20} />
      </button>
    </div>
  );
}