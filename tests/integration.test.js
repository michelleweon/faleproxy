const http = require('http');
const axios = require('axios');
const cheerio = require('cheerio');
const app = require('../app');
const { sampleHtmlWithYale } = require('./test-utils');
const nock = require('nock');

// Set a different port for testing to avoid conflict with the main app
const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
let server;
let mockOrigin;
let originPort;

describe('Integration Tests', () => {
  beforeAll(async () => {
    // Mock external HTTP requests
    nock.disableNetConnect();
    nock.enableNetConnect(/(localhost|127\.0\.0\.1)/);

    const waitForServer = new Promise((resolve, reject) => {
      server = app.listen(TEST_PORT, '127.0.0.1', resolve);
      server.once('error', reject);
    });

    const waitForOrigin = new Promise((resolve, reject) => {
      const onOriginError = error => {
        mockOrigin?.removeListener('listening', onOriginListening);
        reject(error);
      };

      const onOriginListening = () => {
        originPort = mockOrigin.address().port;
        mockOrigin.removeListener('error', onOriginError);
        resolve();
      };

      mockOrigin = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(sampleHtmlWithYale);
      });

      mockOrigin.once('error', onOriginError);
      mockOrigin.listen(0, '127.0.0.1', onOriginListening);
    });

    await Promise.all([waitForServer, waitForOrigin]);
  }, 10000); // Increase timeout for server startup

  afterAll(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    }

    if (mockOrigin) {
      await new Promise(resolve => mockOrigin.close(resolve));
    }

    nock.cleanAll();
    nock.enableNetConnect();
  });

  test('Should replace Yale with Fale in fetched content', async () => {
    const targetUrl = `http://127.0.0.1:${originPort}/`;

    // Make a request to our proxy app
    const response = await axios.post(`${BASE_URL}/fetch`, {
      url: targetUrl
    });

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);

    // Verify Yale has been replaced with Fale in text
    const $ = cheerio.load(response.data.content);
    expect($('title').text()).toBe('Fale University Test Page');
    expect($('h1').text()).toBe('Welcome to Fale University');
    expect($('p').first().text()).toContain('Fale University is a private');

    // Verify URLs remain unchanged
    const links = $('a');
    let hasYaleUrl = false;
    links.each((i, link) => {
      const href = $(link).attr('href');
      if (href && href.includes('yale.edu')) {
        hasYaleUrl = true;
      }
    });
    expect(hasYaleUrl).toBe(true);

    // Verify link text is changed
    expect($('a').first().text()).toBe('About Fale');
  }, 10000); // Increase timeout for this test

  test('Should handle invalid URLs', async () => {
    try {
      await axios.post(`${BASE_URL}/fetch`, {
        url: 'not-a-valid-url'
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      if (!error.response) {
        throw error;
      }
      expect(error.response.status).toBe(500);
    }
  });

  test('Should handle missing URL parameter', async () => {
    try {
      await axios.post(`${BASE_URL}/fetch`, {});
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      if (!error.response) {
        throw error;
      }
      expect(error.response.status).toBe(400);
      expect(error.response.data.error).toBe('URL is required');
    }
  });
});
