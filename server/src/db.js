const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/ivent';

// Detect if SSL is required (Render databases, production, or remote postgres)
const isRemoteOrRender = connectionString.includes('render.com') ||
  connectionString.includes('dpg-') ||
  connectionString.includes('sslmode=require') ||
  process.env.NODE_ENV === 'production';

const poolConfig = {
  connectionString,
};

if (isRemoteOrRender && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')) {
  poolConfig.ssl = {
    rejectUnauthorized: false,
  };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
