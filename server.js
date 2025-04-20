const express = require('express');
const { Pool } = require('pg'); // Add this import
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  user: url.username,
  password: url.password,
  host: url.hostname,
  port: url.port,
  database: url.pathname.split('/')[1],
  ssl: { rejectUnauthorized: false },
  family: 4 // Force IPv4
});


// Basic authentication middleware (for demo purposes)
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer my-secret-token') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Get all artworks
app.get('/api/artworks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM artworks');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a new artwork
app.post('/api/artworks', adminAuth, async (req, res) => {
  const { title, description, imageUrl, project, year, type } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO artworks (title, description, imageUrl, project, year, type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, description, imageUrl, project, year, type]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add artwork' });
  }
});

// Update an artwork
app.put('/api/artworks/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { title, description, imageUrl, project, year, type } = req.body;
  try {
    const result = await pool.query(
      'UPDATE artworks SET title = $1, description = $2, imageUrl = $3, project = $4, year = $5, type = $6 WHERE id = $7 RETURNING *',
      [title, description, imageUrl, project, year, type, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update artwork' });
  }
});

// Delete an artwork
app.delete('/api/artworks/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM artworks WHERE id = $1', [id]);
    res.json({ message: 'Artwork deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete artwork' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});