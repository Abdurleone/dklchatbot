const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: Number,
  category: String,
});
const Service = mongoose.model('Service', serviceSchema);

const RateLimit = require('express-rate-limit');
const limiter = RateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.on('message', async (msg) => {
    try {
      const llmResponse = await axios.post(
        'https://api.x.ai/v1/chat/completions',
        {
          model: 'grok',
          messages: [{ role: 'user', content: msg }],
        },
        { headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` } }
      );

      const intent = llmResponse.data.choices[0].message.content.toLowerCase();
      let response;
      if (intent.includes('service') || intent.includes('test')) {
        const services = await Service.find(
          { $or: [{ name: { $regex: msg, $options: 'i' } }, { category: { $regex: msg, $options: 'i' } }] },
          'name description price'
        ).limit(5);
        response = services.length
          ? services.map((s) => `${s.name}: ${s.description} (Price: ${s.price} KES)`).join('\n')
          : 'No services found. Try rephrasing or ask about something else!';
      } else {
        response = 'I’m not sure what you’re asking. Try asking about lab tests or services!';
      }
      socket.emit('response', response);
    } catch (error) {
      console.error('Error processing message:', error.message);
      socket.emit('response', 'Oops, something went wrong! Try again.');
    }
  });
  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));
// Add a route for the root URL
app.get('/', (req, res) => {
  res.send('Welcome to DKL Chatbot API!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chatbot server running on port ${PORT}`));