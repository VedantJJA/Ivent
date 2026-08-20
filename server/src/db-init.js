const fs = require('fs');
const path = require('path');
const db = require('./db');

async function initDatabase() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await db.query(schema);
    console.log('Database schema initialized successfully');

    // Seed sample clubs if none exist
    const clubsCheck = await db.query('SELECT COUNT(*) as count FROM clubs');
    if (parseInt(clubsCheck.rows[0].count, 10) === 0) {
      await db.query(`
        INSERT INTO clubs (name, description) VALUES
          ('Tech Club', 'Official Technology and Software Engineering Club'),
          ('Design Club', 'Creative UI/UX Design and Media Club'),
          ('Robotics Club', 'Hardware, Robotics and IoT Club')
        ON CONFLICT (name) DO NOTHING;
      `);
      console.log('Default clubs seeded successfully');
    }

    // If script called directly, exit
    if (require.main === module) {
      process.exit(0);
    }
  } catch (err) {
    console.error('Database initialization error:', err);
    if (require.main === module) {
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase };
