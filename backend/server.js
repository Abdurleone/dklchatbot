const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize Express and Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Define MongoDB Schema for Services (expandable to FAQs, etc.)
const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: Number,
  category: String,
});
const Service = mongoose.model('Service', serviceSchema);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Fast, cost-effective; use 'gemini-1.5-pro' for more advanced

// Middleware for rate limiting
const RateLimit = require('express-rate-limit');
const limiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests
});
app.use(limiter);

// Socket.io handler
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('message', async (msg) => {
    try {
      // Step 1: Use Gemini to classify intent
      const prompt = `Classify the intent of this user query for a lab chatbot. Possible intents: "service" (for lab tests/services), "faq" (general questions), "appointment" (booking). Respond with only the intent word. Query: ${msg}`;
      const result = await model.generateContent(prompt);
      const intent = await result.response.text().toLowerCase().trim(); // e.g., "service"

      // Step 2: Query MongoDB based on intent
      let response;
      if (intent === 'service' || msg.toLowerCase().includes('test') || msg.toLowerCase().includes('service')) {
        const services = await Service.find(
          { $or: [{ name: { $regex: msg, $options: 'i' } }, { category: { $regex: msg, $options: 'i' } }] },
          'name description price'
        ).limit(5);
        response = services.length
          ? `Here are matching services:\n${services.map((s) => `${s.name}: ${s.description} (KES ${s.price})`).join('\n')}`
          : 'No services found. Try searching for a specific test like "blood test".';
      } else if (intent === 'faq') {
        response = 'For FAQs, check our website or contact support. (Expand this with a FAQ collection later.)';
      } else {
        response = `Intent detected: ${intent}. I'm here to help with lab services—try asking about tests!`;
      }

      // Step 3: Send response
      socket.emit('response', response);
    } catch (error) {
      console.error('Error processing message:', error.message);
      socket.emit('response', 'Sorry, an error occurred. Please try again.');
    }
  });

  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chatbot server running on port ${PORT}`));