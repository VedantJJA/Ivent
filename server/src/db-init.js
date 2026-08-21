const fs = require('fs');
const path = require('path');
const db = require('./db');

async function initDatabase() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await db.query(schema);

    // Schema cleanup migrations for legacy tables / redundant columns / foreign keys
    try {
      await db.query('ALTER TABLE users DROP COLUMN IF EXISTS is_admin;');
      await db.query('DROP TABLE IF EXISTS station_bundles;');
      await db.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'scan_log_registration_id_fkey'
          ) THEN
            ALTER TABLE scan_log DROP CONSTRAINT scan_log_registration_id_fkey;
            ALTER TABLE scan_log ADD CONSTRAINT scan_log_registration_id_fkey
              FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE;
          END IF;
        END $$;
      `);
    } catch (e) {
      console.warn('Migration note:', e.message);
    }

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
