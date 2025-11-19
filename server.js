// server.js - Express API server with manual trigger and cron support
const express = require('express');
const { runScraper } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Avaloq Candidate Scraper',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /',
      trigger: 'POST /scrape (requires x-auth-token header)',
      cronTrigger: 'GET /cron-trigger?secret=XXX',
      status: 'GET /status'
    }
  });
});

// Manual trigger endpoint
app.post('/scrape', async (req, res) => {
  // Optional authentication token
  const authToken = req.headers['x-auth-token'];
  const expectedToken = process.env.AUTH_TOKEN;
  
  if (expectedToken && authToken !== expectedToken) {
    console.log('⚠️  Unauthorized scrape attempt');
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing x-auth-token header'
    });
  }
  
  console.log('✓ Manual scrape triggered via API');
  
  // Send immediate response
  res.json({
    status: 'started',
    message: 'Scraper job initiated. Check logs for progress.',
    timestamp: new Date().toISOString()
  });
  
  // Run scraper asynchronously
  runScraper()
    .then(result => {
      console.log('✓ Manual scraper completed successfully:', result);
    })
    .catch(error => {
      console.error('✗ Manual scraper failed:', error.message);
    });
});

// Status endpoint (simple health check)
app.get('/status', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    uptimeFormatted: formatUptime(process.uptime()),
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      hasGoogleCredentials: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID),
      hasAirtableCredentials: !!(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID)
    },
    timestamp: new Date().toISOString()
  });
});

// Cron endpoint (called by Render cron jobs or external schedulers)
app.get('/cron-trigger', async (req, res) => {
  // Verify cron secret
  const cronSecret = req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;
  
  if (expectedSecret && cronSecret !== expectedSecret) {
    console.log('⚠️  Invalid cron secret attempt');
    return res.status(401).json({ 
      error: 'Invalid cron secret',
      message: 'The secret parameter is missing or incorrect'
    });
  }
  
  console.log('✓ Scheduled scrape triggered via cron');
  
  res.json({
    status: 'started',
    message: 'Scheduled scraper job initiated',
    timestamp: new Date().toISOString()
  });
  
  // Run scraper asynchronously
  runScraper()
    .then(result => {
      console.log('✓ Scheduled scraper completed:', result);
    })
    .catch(error => {
      console.error('✗ Scheduled scraper failed:', error.message);
    });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.path} not found`,
    availableEndpoints: ['GET /', 'POST /scrape', 'GET /status', 'GET /cron-trigger']
  });
});

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Avaloq Candidate Scraper Server                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Server running on port ${PORT}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  Health:  http://localhost:${PORT}/`);
  console.log(`  Trigger: POST http://localhost:${PORT}/scrape`);
  console.log(`  Cron:    GET http://localhost:${PORT}/cron-trigger?secret=XXX`);
  console.log(`  Status:  http://localhost:${PORT}/status`);
  console.log('');
  console.log('Server ready to accept requests ✓');
  console.log('═══════════════════════════════════════════════════════════');
});