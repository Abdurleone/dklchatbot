const app = require('./server');
const http = require('http');
const { Server } = require('socket.io');
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Socket.io Handler
const mongoose = require('mongoose');
const Service = mongoose.models.Service || mongoose.model('Service');
const FAQ = mongoose.models.FAQ || mongoose.model('FAQ');
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

io.on('connection', (socket) => {
	console.log('User connected:', socket.id);
	const sessionId = socket.id;

	socket.on('message', async (msg) => {
		try {
			const prompt = `Classify the intent of this user query for a lab chatbot. Possible intents: "service" (for lab tests/services), "faq" (general questions), "appointment" (booking). Respond with only the intent word. Query: ${msg}`;
			const result = await model.generateContent(prompt);
			const intent = await result.response.text().toLowerCase().trim();

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
						{ category: { $regex: msg, $options: 'i' } },
					],
				}).limit(3);
				response = faqs.length
					? `Here are some answers:\n${faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
					: 'No matching FAQ found. Please ask another question or contact support.';
			} else {
				response = `Intent detected: ${intent}. I'm here to help with lab services—try asking about tests!`;
			}

			let conversation = await Conversation.findOne({ sessionId });
			if (!conversation) {
				conversation = new Conversation({ sessionId, messages: [] });
			}
			conversation.messages.push({ sender: 'user', text: msg });
			conversation.messages.push({ sender: 'bot', text: response });
			await conversation.save();

			socket.emit('response', response);
		} catch (error) {
			console.error('Error processing message:', error.message);
			socket.emit('response', 'Sorry, an error occurred. Please try again.');
		}
	});

	socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

server.listen(PORT, () => console.log(`Chatbot server running on port ${PORT}`));
