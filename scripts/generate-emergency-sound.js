const fs = require('fs');
const { exec } = require('child_process');

// Create a simple emergency siren sound using Web Audio API
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const oscillator = audioContext.createOscillator();
const gainNode = audioContext.createGain();

// Configure the oscillator
oscillator.type = 'sine';
oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.5); // A4 note

// Configure the gain node
gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
gainNode.gain.setValueAtTime(0.5, audioContext.currentTime + 0.5);

// Connect nodes
oscillator.connect(gainNode);
gainNode.connect(audioContext.destination);

// Start and stop the sound
oscillator.start();
oscillator.stop(audioContext.currentTime + 1);

// Export the audio to MP3
const mediaStreamDestination = audioContext.createMediaStreamDestination();
gainNode.connect(mediaStreamDestination);

const mediaRecorder = new MediaRecorder(mediaStreamDestination.stream);
const audioChunks = [];

mediaRecorder.ondataavailable = (event) => {
  audioChunks.push(event.data);
};

mediaRecorder.onstop = () => {
  const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
  const audioUrl = URL.createObjectURL(audioBlob);
  
  // Save the file
  fetch(audioUrl)
    .then(response => response.arrayBuffer())
    .then(buffer => {
      fs.writeFileSync('public/emergency-alert.mp3', Buffer.from(buffer));
      console.log('Emergency alert sound generated successfully!');
    });
};

mediaRecorder.start();
setTimeout(() => mediaRecorder.stop(), 1000); 