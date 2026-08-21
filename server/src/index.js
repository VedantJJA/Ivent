require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const registrationRoutes = require('./routes/registrations');
const checkinRoutes = require('./routes/checkin');
const adminRoutes = require('./routes/admin');
const { initDatabase } = require('./db-init');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.CLIENT_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (server-to-server, curl, test runners, mobile native apps)
    if (!origin) return callback(null, true);

    // Allow explicitly configured client URLs
    if (allowedOrigins.some(o => origin === o || (o !== '*' && origin.startsWith(o)))) {
      return callback(null, true);
    }

    // Allow localhost and loopback interfaces for local development
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Allow Render deployment domains (*.onrender.com)
    if (/^https:\/\/[a-zA-Z0-9-]+\.onrender\.com$/.test(origin)) {
      return callback(null, true);
    }

    // Disallow unknown external origins
    return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
});

// Make io accessible to route handlers
app.set('io', io);

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/events', eventRoutes);
app.use('/admin', adminRoutes);
app.use('/', registrationRoutes);
app.use('/events', checkinRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint for status
app.get('/', (req, res) => {
  res.json({ service: 'Ivent API Server', status: 'healthy', version: '1.0.0' });
});

// 404 Handler - returns JSON instead of Express default HTML
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global Error Handler - returns JSON instead of Express default HTML
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-event', (eventId) => {
    socket.join(`event:${eventId}`);
    console.log(`Socket ${socket.id} joined event:${eventId}`);
  });

  socket.on('leave-event', (eventId) => {
    socket.leave(`event:${eventId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

// Initialize database schema and start server
initDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Ivent server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database on startup, starting server anyway:', err.message);
    server.listen(PORT, () => {
      console.log(`Ivent server running on port ${PORT}`);
    });
  });

module.exports = { app, server, io };
