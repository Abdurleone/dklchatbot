// Simple API key middleware for admin endpoints
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'changeme';
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
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

// Import FAQ model
const FAQ = require('./models/faq');

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

// Get all FAQs
app.get('/admin/faqs', requireApiKey, async (req, res) => {
  try {
    const faqs = await FAQ.find();
    res.json(faqs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get FAQ by ID
app.get('/admin/faqs/:id', requireApiKey, async (req, res) => {
  try {
    const faq = await FAQ.findById(req.params.id);
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json(faq);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update FAQ by ID
app.put('/admin/faqs/:id', requireApiKey, async (req, res) => {
  try {
    const faq = await FAQ.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json(faq);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete FAQ by ID
app.delete('/admin/faqs/:id', requireApiKey, async (req, res) => {
  try {
    const faq = await FAQ.findByIdAndDelete(req.params.id);
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json({ message: 'FAQ deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
        // Search FAQ collection for matching question or tags
        const faqs = await FAQ.find({
          $or: [
            { question: { $regex: msg, $options: 'i' } },
            { tags: { $regex: msg, $options: 'i' } },
            { category: { $regex: msg, $options: 'i' } }
          ]
        }).limit(3);
        response = faqs.length
          ? `Here are some answers:
${faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
          : 'No matching FAQ found. Please ask another question or contact support.';
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
app.get('/', (req, res) => {
  res.send('Welcome to DKL Chatbot API!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chatbot server running on port ${PORT}`));

// Export app for testing
module.exports = app;