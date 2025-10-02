const request = require('supertest');
const mongoose = require('mongoose');
require('dotenv').config();
const app = require('../server');

const API_KEY = process.env.ADMIN_API_KEY || 'changeme';

// Helper to set API key header
const apiKeyHeader = { 'x-api-key': API_KEY };

describe('Admin FAQ Endpoints', () => {
  let faqId;

  beforeAll(async () => {
    // Wait for DB connection
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  it('should create a FAQ', async () => {
    const res = await request(app)
      .post('/admin/faqs')
      .set(apiKeyHeader)
      .send({
        question: 'What are your opening hours?',
        answer: 'We are open from 8am to 6pm.',
        tags: ['hours', 'opening'],
        category: 'general',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.question).toBe('What are your opening hours?');
    faqId = res.body._id;
  });

  it('should get all FAQs', async () => {
    const res = await request(app)
      .get('/admin/faqs')
      .set(apiKeyHeader);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should get FAQ by ID', async () => {
    const res = await request(app)
      .get(`/admin/faqs/${faqId}`)
      .set(apiKeyHeader);
    expect(res.statusCode).toBe(200);
    expect(res.body._id).toBe(faqId);
  });

  it('should update FAQ by ID', async () => {
    const res = await request(app)
      .put(`/admin/faqs/${faqId}`)
      .set(apiKeyHeader)
      .send({ answer: 'We are open from 8am to 8pm.' });
    expect(res.statusCode).toBe(200);
    expect(res.body.answer).toBe('We are open from 8am to 8pm.');
  });

  it('should delete FAQ by ID', async () => {
    const res = await request(app)
      .delete(`/admin/faqs/${faqId}`)
      .set(apiKeyHeader);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('FAQ deleted');
  });
});
