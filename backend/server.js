const express = require('express');
// Remove server and socket.io imports
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const RateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Initialize Express
const app = express();

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// MongoDB Schemas
const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: Number,
  category: String,
});
const Service = mongoose.model('Service', serviceSchema);

const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: String,
  category: String,
  tags: [String],
});
const FAQ = mongoose.model('FAQ', faqSchema);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};
const User = mongoose.model('User', userSchema);

const conversationSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  messages: [{ sender: String, text: String, timestamp: { type: Date, default: Date.now } }],
  startedAt: { type: Date, default: Date.now },
});
const Conversation = mongoose.model('Conversation', conversationSchema);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Middleware
app.use(express.json());
app.use(express.static('public')); // Serve chat-widget.html
const limiter = RateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

// API Key Middleware for Admin Endpoints
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'changeme'; // Update in .env
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// JWT Auth Middleware
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

// Routes
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));
app.get('/', (req, res) => res.send('Welcome to DKL Chatbot API!'));

// User Registration
app.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const user = new User({ username, email, password });
    await user.save();
    res.status(201).json({ message: 'User registered' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// User Login
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Conversation History
app.get('/conversations/:sessionId', requireAuth, async (req, res) => {
  try {
    const convo = await Conversation.findOne({ sessionId: req.params.sessionId });
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get All Conversations
app.get('/admin/conversations', requireApiKey, async (req, res) => {
  try {
    const convos = await Conversation.find().limit(100).sort({ startedAt: -1 });
    res.json(convos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Add FAQ
// Admin: Add FAQ
app.post('/admin/faqs', requireApiKey, async (req, res) => {
  try {
    const faq = new FAQ(req.body);
    await faq.save();
    res.status(201).json(faq);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: Get all FAQs
app.get('/admin/faqs', requireApiKey, async (req, res) => {
  try {
    const faqs = await FAQ.find();
    res.json(faqs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get FAQ by ID
app.get('/admin/faqs/:id', requireApiKey, async (req, res) => {
  try {
    const faq = await FAQ.findById(req.params.id);
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json(faq);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update FAQ by ID
app.put('/admin/faqs/:id', requireApiKey, async (req, res) => {
  try {
    const faq = await FAQ.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json(faq);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: Delete FAQ by ID
app.delete('/admin/faqs/:id', requireApiKey, async (req, res) => {
  try {
    const faq = await FAQ.findByIdAndDelete(req.params.id);
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json({ message: 'FAQ deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io handler moved to index.js

// Export only the Express app for testing
module.exports = app;