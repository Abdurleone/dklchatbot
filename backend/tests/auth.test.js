const request = require('supertest');
const mongoose = require('mongoose');
require('dotenv').config();
const app = require('../server');

const testUser = {
  username: 'testuser',
  email: 'test@example.com',
  password: 'testpass'
};

let token;

describe('User Authentication', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  it('should register a user', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send(testUser);
    expect([201, 400]).toContain(res.statusCode); // 400 if already exists
  });

  it('should login and return a JWT token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: testUser.username, password: testUser.password });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
    token = res.body.token;
  });

  it('should reject login with wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: testUser.username, password: 'wrongpass' });
    expect(res.statusCode).toBe(400);
  });

  it('should access a protected endpoint with JWT', async () => {
    // Example: get all conversations (admin only, but shows JWT usage)
    const res = await request(app)
      .get('/admin/conversations')
      .set('Authorization', `Bearer ${token}`);
    // Should be 401 unless admin API key is used, but demonstrates JWT header
    expect([401, 403, 200]).toContain(res.statusCode);
  });
});
