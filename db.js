const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Render PostgreSQL
});

// Create the artworks table if it doesn't exist
const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artworks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      imageUrl VARCHAR(255) NOT NULL,
      project VARCHAR(255),
      year INT,
      type VARCHAR(100)
    );
  `);
};

initDb().catch(err => console.error('Error initializing database:', err));

module.exports = pool;