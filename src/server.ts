import express from 'express';
import path from 'path';
import { setupSchedulers, setupGracefulShutdown } from './queues';
import ordersRouter from './routes/orders';
import dashboardRouter from './routes/dashboard';
import eventsRouter from './routes/events';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/orders', ordersRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/events', eventsRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Start
async function start() {
  try {
    await setupSchedulers();
    console.log('[OK] Job schedulers configured');
  } catch (err: any) {
    console.error('[WARN] Failed to setup schedulers:', err.message);
  }

  setupGracefulShutdown();

  app.listen(PORT, () => {
    console.log(`[OK] glide-mq demo server running on http://localhost:${PORT}`);
  });
}

start();
