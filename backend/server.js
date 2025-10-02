const jwt = require('jsonwebtoken');
const User = require('./models/user');
// User registration
app.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const user = new User({ username, email, password });
    await user.save();
    res.status(201).json({ message: 'User registered' });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// User login
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
// Endpoint: Get conversation history by sessionId
app.get('/conversations/:sessionId', async (req, res) => {
  try {
    const convo = await Conversation.findOne({ sessionId: req.params.sessionId });
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: Get all conversations
app.get('/admin/conversations', requireApiKey, async (req, res) => {
  try {
    const convos = await Conversation.find().limit(100).sort({ startedAt: -1 });
    res.json(convos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Simple API key middleware for admin endpoints
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'changeme';
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
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

// Define MongoDB Schema for Services
const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: Number,
  category: String,
});
const Service = mongoose.model('Service', serviceSchema);

// Import FAQ and Conversation models
const FAQ = require('./models/faq');
const Conversation = require('./models/conversation');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Fast, cost-effective; use 'gemini-1.5-pro' for more advanced

// Middleware for rate limiting
const RateLimit = require('express-rate-limit');
const limiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests
});

app.use(express.json()); // For parsing JSON bodies
app.use(limiter);

// Admin endpoints for FAQ management (secured)
app.post('/admin/faqs', requireApiKey, async (req, res) => {
  try {
    const faq = new FAQ(req.body);
    await faq.save();
    res.status(201).json(faq);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Socket.io handler
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Use socket.id as sessionId for anonymous users
  let sessionId = socket.id;

  socket.on('message', async (msg) => {
    try {
      // Step 1: Use Gemini to classify intent
      const prompt = `Classify the intent of this user query for a lab chatbot. Possible intents: "service" (for lab tests/services), "faq" (general questions), "appointment" (booking). Respond with only the intent word. Query: ${msg}`;
      const result = await model.generateContent(prompt);
      const intent = await result.response.text().toLowerCase().trim();

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
        const faqs = await FAQ.find({
          $or: [
            { question: { $regex: msg, $options: 'i' } },
            { tags: { $regex: msg, $options: 'i' } },
            { category: { $regex: msg, $options: 'i' } }
          ]
        }).limit(3);
        response = faqs.length
          ? `Here are some answers:\n${faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
          : 'No matching FAQ found. Please ask another question or contact support.';
      } else {
        response = `Intent detected: ${intent}. I'm here to help with lab services—try asking about tests!`;
      }

      // Step 3: Log conversation to MongoDB
      let conversation = await Conversation.findOne({ sessionId });
      if (!conversation) {
        conversation = new Conversation({ sessionId, messages: [] });
      }
      conversation.messages.push({ sender: 'user', text: msg });
      conversation.messages.push({ sender: 'bot', text: response });
      await conversation.save();

      // Step 4: Send response
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
app.get('/', (req, res) => {
  res.send('Welcome to DKL Chatbot API!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chatbot server running on port ${PORT}`));

// Export app for testing
module.exports = app;
}
module.exports = app;