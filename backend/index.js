const app = require('./server');
const http = require('http');
const { Server } = require('socket.io');
const PORT = process.env.PORT || 3000;

const { translate, detect } = require('libretranslate');

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
			// Detect language
			let userLang = 'en';
			try {
				const detected = await detect(msg);
				userLang = detected && detected.length > 0 ? detected[0].language : 'en';
			} catch (e) {
				userLang = 'en';
			}

			let msgForIntent = msg;
			if (userLang !== 'en') {
				// Translate to English for intent classification
				try {
					msgForIntent = await translate(msg, { from: userLang, to: 'en' });
				} catch (e) {
					msgForIntent = msg;
				}
			}

			const prompt = `Classify the intent of this user query for a lab chatbot. Possible intents: "service" (for lab tests/services), "faq" (general questions), "appointment" (booking). Respond with only the intent word. Query: ${msgForIntent}`;
			const result = await model.generateContent(prompt);
			const intent = await result.response.text().toLowerCase().trim();

			let response;
			if (intent === 'service' || msgForIntent.toLowerCase().includes('test') || msgForIntent.toLowerCase().includes('service')) {
				const services = await Service.find(
					{ $or: [{ name: { $regex: msgForIntent, $options: 'i' } }, { category: { $regex: msgForIntent, $options: 'i' } }] },
					'name description price'
				).limit(5);
				response = services.length
					? `Here are matching services:\n${services.map((s) => `${s.name}: ${s.description} (KES ${s.price})`).join('\n')}`
					: 'No services found. Try searching for a specific test like "blood test".';
			} else if (intent === 'faq') {
				const faqs = await FAQ.find({
					$or: [
						{ question: { $regex: msgForIntent, $options: 'i' } },
						{ tags: { $regex: msgForIntent, $options: 'i' } },
						{ category: { $regex: msgForIntent, $options: 'i' } },
					],
				}).limit(3);
				response = faqs.length
					? `Here are some answers:\n${faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
					: 'No matching FAQ found. Please ask another question or contact support.';
			} else {
				response = `Intent detected: ${intent}. I'm here to help with lab services—try asking about tests!`;
			}

					// Translate response back to user's language if needed, with fallback logic
					let finalResponse = response;
					let translationFailed = false;
					if (userLang !== 'en') {
						try {
							finalResponse = await translate(response, { from: 'en', to: userLang });
						} catch (e) {
							finalResponse = response + '\n\n[Sorry, I could not translate the response. Showing in English.]';
							translationFailed = true;
						}
					}

			let conversation = await Conversation.findOne({ sessionId });
			if (!conversation) {
				conversation = new Conversation({ sessionId, messages: [] });
			}
			conversation.messages.push({ sender: 'user', text: msg });
			conversation.messages.push({ sender: 'bot', text: finalResponse });
			await conversation.save();

			socket.emit('response', finalResponse);
		} catch (error) {
			console.error('Error processing message:', error.message);
			socket.emit('response', 'Sorry, an error occurred. Please try again.');
		}
	});

	socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

server.listen(PORT, () => console.log(`Chatbot server running on port ${PORT}`));
