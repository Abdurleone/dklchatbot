const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  userId: { type: String },
  sessionId: { type: String },
  messages: [
    {
      sender: { type: String, required: true },   text: { type: String, required: true },
      text: { type: String, required: true },
      timestamp: { type: Date, default: Date.now }
    }
  ],
  startedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);