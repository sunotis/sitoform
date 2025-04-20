const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000; // Use Render's assigned port or default to 3000

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get artworks
app.get('/api/artworks', (req, res) => {
  fs.readFile(path.join(__dirname, 'data', 'artworks.json'), 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading artworks.json:', err);
      res.status(500).json({ error: 'Failed to load artworks' });
      return;
    }
    res.json(JSON.parse(data));
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});