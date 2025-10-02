const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  userId: { type: String }, // Optional: can be null for anonymous
  sessionId: { type: String }, // For anonymous sessions
  messages: [
    {
      sender: { type: String, required: true }, // 'user' or 'bot'
      text: { type: String, required: true },
      timestamp: { type: Date, default: Date.now }
    }
  ],
  startedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);