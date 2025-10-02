const app = require('./server');
const winston = require('winston');

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
	),
	transports: [
		new winston.transports.Console(),
		new winston.transports.File({ filename: 'chatbot.log' })
	],
});
const http = require('http');
const { Server } = require('socket.io');
const PORT = process.env.PORT || 3000;

const { translate, detect } = require('libretranslate');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const mongoose = require('mongoose');
const Service = mongoose.models.Service || mongoose.model('Service');
// Update FAQ model to support language field
const faqSchema = new mongoose.Schema({
	question: { type: String, required: true },
	answer: String,
	category: String,
	tags: [String],
	language: { type: String, default: 'en' }, // ISO code
});
const FAQ = mongoose.models.FAQ || mongoose.model('FAQ', faqSchema);
// Multilingual FAQ Management Endpoints
// Create FAQ (specify language)
app.post('/admin/faqs', async (req, res) => {
	try {
		const faq = new FAQ(req.body);
		await faq.save();
		res.status(201).json(faq);
	} catch (err) {
		logger.error(`[FAQ Create Error] ${err.message}`);
		res.status(400).json({ error: err.message });
	}
});

// Get all FAQs (optionally filter by language)
// Customized FAQ retrieval: language fallback, keyword, category, tag, multi-language
app.get('/faqs', async (req, res) => {
	try {
		const lang = req.query.language || 'en';
		const keyword = req.query.keyword || '';
		const category = req.query.category;
		const tag = req.query.tag;
		let query = { $or: [] };

		// Build keyword search
		if (keyword) {
			query.$or.push(
				{ question: { $regex: keyword, $options: 'i' } },
				{ answer: { $regex: keyword, $options: 'i' } },
				{ tags: { $regex: keyword, $options: 'i' } },
				{ category: { $regex: keyword, $options: 'i' } }
			);
		}

		// Category filter
		if (category) {
			query.category = category;
		}

		// Tag filter
		if (tag) {
			query.tags = tag;
		}

		// Language filter
		query.language = lang;

		// Remove $or if no keyword
		if (!keyword) delete query.$or;

		let faqs = await FAQ.find(query);

		// Language fallback if no results
		if (faqs.length === 0 && lang !== 'en') {
			let fallbackQuery = { ...query, language: 'en' };
			faqs = await FAQ.find(fallbackQuery);
			logger.warn(`[FAQ Fallback] No FAQs found for language '${lang}', returning English.`);
		}

		// Multi-language results: if requested, return both user language and English
		if (req.query.multi === 'true' && lang !== 'en') {
			const englishFaqs = await FAQ.find({ ...query, language: 'en' });
			faqs = [...faqs, ...englishFaqs];
		}

		res.json(faqs);
	} catch (err) {
		logger.error(`[FAQ Get All Error] ${err.message}`);
		res.status(500).json({ error: err.message });
	}
});

// Get FAQ by ID
app.get('/faqs/:id', async (req, res) => {
	try {
		const faq = await FAQ.findById(req.params.id);
		if (!faq) return res.status(404).json({ error: 'FAQ not found' });
		res.json(faq);
	} catch (err) {
		logger.error(`[FAQ Get By ID Error] ${err.message}`);
		res.status(500).json({ error: err.message });
	}
});

// Update FAQ by ID
app.put('/admin/faqs/:id', async (req, res) => {
	try {
		const faq = await FAQ.findByIdAndUpdate(req.params.id, req.body, { new: true });
		if (!faq) return res.status(404).json({ error: 'FAQ not found' });
		res.json(faq);
	} catch (err) {
		logger.error(`[FAQ Update Error] ${err.message}`);
		res.status(400).json({ error: err.message });
	}
});

// Delete FAQ by ID
app.delete('/admin/faqs/:id', async (req, res) => {
	try {
		const faq = await FAQ.findByIdAndDelete(req.params.id);
		if (!faq) return res.status(404).json({ error: 'FAQ not found' });
		res.json({ message: 'FAQ deleted' });
	} catch (err) {
		logger.error(`[FAQ Delete Error] ${err.message}`);
		res.status(500).json({ error: err.message });
	}
});
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

io.on('connection', (socket) => {
	logger.info(`User connected: ${socket.id}`);
	const sessionId = socket.id;


		socket.on('message', async (msg) => {
			// Error handling context
			let userLang = 'en';
			let msgForIntent = msg;
			let intent = '';
			let response = '';
			let finalResponse = '';
			let errorMsg = '';
			try {
				// Detect language
				try {
					const detected = await detect(msg);
					userLang = detected && detected.length > 0 ? detected[0].language : 'en';
					logger.info(`[Language Detection] User message: "${msg}" | Detected language: ${userLang}`);
				} catch (e) {
					userLang = 'en';
					errorMsg += '[Language detection failed. Assuming English.]\n';
					logger.error(`[Language Detection Error] ${e.message}`);
				}

				// Translate to English for intent classification
				if (userLang !== 'en') {
					try {
						msgForIntent = await translate(msg, { from: userLang, to: 'en' });
						logger.info(`[Translation] Translated user message to English: "${msgForIntent}"`);
					} catch (e) {
						msgForIntent = msg;
						errorMsg += '[Translation to English failed. Processing in original language.]\n';
						logger.error(`[Translation Error] ${e.message}`);
					}
				}

				// Intent classification
				try {
					const prompt = `Classify the intent of this user query for a lab chatbot. Possible intents: "service" (for lab tests/services), "faq" (general questions), "appointment" (booking). Respond with only the intent word. Query: ${msgForIntent}`;
					const result = await model.generateContent(prompt);
					intent = await result.response.text().toLowerCase().trim();
					logger.info(`[Intent Classification] Intent: ${intent}`);
				} catch (e) {
					intent = '';
					errorMsg += '[Intent classification failed. Defaulting to general response.]\n';
					logger.error(`[Intent Classification Error] ${e.message}`);
				}

				// Response generation
				try {
					if (intent === 'service' || msgForIntent.toLowerCase().includes('test') || msgForIntent.toLowerCase().includes('service')) {
						const services = await Service.find(
							{ $or: [{ name: { $regex: msgForIntent, $options: 'i' } }, { category: { $regex: msgForIntent, $options: 'i' } }] },
							'name description price'
						).limit(5);
						response = services.length
							? `Here are matching services:\n${services.map((s) => `${s.name}: ${s.description} (KES ${s.price})`).join('\n')}`
							: 'No services found. Try searching for a specific test like "blood test".';
						logger.info(`[Service Response] ${response}`);
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
						logger.info(`[FAQ Response] ${response}`);
					} else {
						response = `Intent detected: ${intent}. I'm here to help with lab services—try asking about tests!`;
						logger.info(`[Default Response] ${response}`);
					}
				} catch (e) {
					response = 'Sorry, I could not process your request due to a server error.';
					errorMsg += '[Response generation failed.]\n';
					logger.error(`[Response Generation Error] ${e.message}`);
				}

				// Translate response back to user's language if needed, with fallback logic
				finalResponse = response;
				if (userLang !== 'en') {
					try {
						finalResponse = await translate(response, { from: 'en', to: userLang });
						logger.info(`[Translation] Translated bot response to user language (${userLang}): "${finalResponse}"`);
					} catch (e) {
						finalResponse = response + '\n\n[Sorry, I could not translate the response. Showing in English.]';
						errorMsg += '[Translation to user language failed. Showing in English.]\n';
						logger.error(`[Translation to User Language Error] ${e.message}`);
					}
				}

				// Add error messages if any
				if (errorMsg) {
					finalResponse += '\n\n' + errorMsg.trim();
					logger.warn(`[Error Messages] ${errorMsg.trim()}`);
				}

				// Save conversation
				try {
					let conversation = await Conversation.findOne({ sessionId });
					if (!conversation) {
						conversation = new Conversation({ sessionId, messages: [] });
					}
					conversation.messages.push({ sender: 'user', text: msg });
					conversation.messages.push({ sender: 'bot', text: finalResponse });
					await conversation.save();
					logger.info(`[Conversation Saved] Session: ${sessionId}`);
				} catch (e) {
					// Log but don't block response
					logger.error(`[Conversation Save Error] ${e.message}`);
				}

				socket.emit('response', finalResponse);
				logger.info(`[Socket Emit] Response sent to user.`);
			} catch (error) {
				console.error(`[General Error] ${error.message}`);
				socket.emit('response', 'Sorry, an error occurred. Please try again.');
			}
		});

	socket.on('disconnect', () => logger.info(`User disconnected: ${socket.id}`));
});

server.listen(PORT, () => logger.info(`Chatbot server running on port ${PORT}`));
