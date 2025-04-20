const express = require('express');
const cors = require('cors');
const pool = require('./db');
const app = express();

app.use(cors({ origin: 'https://sitoform.com' }));
app.use(express.json());
app.use(express.static('public'));

// Basic authentication middleware (for demo purposes)
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer my-secret-token') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.get('/test-db', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT 1 + 1 AS result');
      res.json({ success: true, result: rows[0].result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

// Get all artworks
app.get('/api/artworks', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM artworks');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a new artwork
app.post('/api/artworks', adminAuth, async (req, res) => {
  const { title, description, imageUrl, project, year, type } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO artworks (title, description, imageUrl, project, year, type) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, imageUrl, project, year, type]
    );
    const [newArtwork] = await pool.query('SELECT * FROM artworks WHERE id = ?', [result.insertId]);
    res.json(newArtwork[0]);
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
    await pool.query(
      'UPDATE artworks SET title = ?, description = ?, imageUrl = ?, project = ?, year = ?, type = ? WHERE id = ?',
      [title, description, imageUrl, project, year, type, id]
    );
    const [updatedArtwork] = await pool.query('SELECT * FROM artworks WHERE id = ?', [id]);
    res.json(updatedArtwork[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update artwork' });
  }
});

// Delete an artwork
app.delete('/api/artworks/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM artworks WHERE id = ?', [id]);
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