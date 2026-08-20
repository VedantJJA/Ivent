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
  process.env.CLIENT_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server or curl/mobile
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o) || o === '*')) {
      return callback(null, true);
    }
    // Allow any .onrender.com subdomain for Render preview / production instances
    if (origin.endsWith('.onrender.com') || origin.includes('localhost')) {
      return callback(null, true);
    }
    return callback(null, true); // Permissive in testing
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
