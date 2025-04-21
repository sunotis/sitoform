const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const Client = require('ssh2-sftp-client');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
    process.exit(1);
  } else {
    console.log('Database connection successful');
    release();
  }
});

const supabaseUrl = 'https://ydfkrwjafnuvdvezpkcp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseKey) {
  throw new Error('SUPABASE_KEY environment variable is not set');
}
const supabaseClient = createClient(supabaseUrl, supabaseKey);


// GET /api/artworks (fetch sorted by order)
app.get('/api/artworks', async (req, res) => {
  try {
    const { data, error } = await supabaseClient
      .from('artworks')
      .select('*')
      .order('order', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching artworks:', error);
    res.status(500).json({ error: 'Failed to fetch artworks' });
  }
});

// PATCH /api/artworks/:id (edit project)
app.patch('/api/artworks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, project, year, type, description, imageurl } = req.body;
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const updates = {};
    if (title) updates.title = title;
    if (project) updates.project = project;
    if (year) updates.year = year;
    if (type) updates.type = type;
    if (description) updates.description = description;
    if (imageurl) updates.imageurl = imageurl;

    const { error } = await supabaseClient
      .from('artworks')
      .update(updates)
      .eq('id', id);
    if (error) throw error;

    res.json({ message: 'Artwork updated successfully' });
  } catch (error) {
    console.error('Error updating artwork:', error);
    res.status(500).json({ error: 'Failed to update artwork' });
  }
});

// PATCH /api/artworks/reorder (update order)
app.patch('/api/artworks/reorder', async (req, res) => {
  const { order } = req.body; // Array of { id, order }
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    for (const { id, order: newOrder } of order) {
      const { error } = await supabaseClient
        .from('artworks')
        .update({ order: newOrder })
        .eq('id', id);
      if (error) throw error;
    }

    res.json({ message: 'Order updated successfully' });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// Existing POST /api/artworks (unchanged, but ensure order is set)
app.post('/api/artworks', multer().single('image'), async (req, res) => {
    const { title, project, year, type, description } = req.body;
    const token = req.headers.authorization?.split('Bearer ')[1];
  
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
  
    try {
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
  
      let imageurl = '';
      if (req.file) {
        const sftp = new Client();
        try {
          console.log('Connecting to SFTP:', {
            host: process.env.SFTP_HOST,
            port: process.env.SFTP_PORT,
            username: process.env.SFTP_USERNAME
          }); // Debug: Log SFTP config (excluding password)
          await sftp.connect({
            host: process.env.SFTP_HOST,
            port: parseInt(process.env.SFTP_PORT) || 22, // Ensure port is a number, default to 22
            username: process.env.SFTP_USERNAME,
            password: process.env.SFTP_PASSWORD,
            retries: 3, // Retry connection up to 3 times
            readyTimeout: 10000 // 10s timeout
          });
          const remotePath = `/sitoform_com/images/${req.file.originalname}`;
          console.log('Uploading to SFTP:', remotePath); // Debug
          await sftp.put(req.file.buffer, remotePath);
          imageurl = `https://sitoform.com/images/${req.file.originalname}`;
          console.log('SFTP upload successful:', imageurl); // Debug
          await sftp.end();
        } catch (sftpError) {
          console.error('SFTP error:', sftpError);
          await sftp.end().catch(() => {}); // Ensure SFTP connection closes
          return res.status(500).json({ error: `Failed to upload image to SFTP: ${sftpError.message}` });
        }
      }
  
      // Get max order and set new order as max + 1
      const { data: maxOrderData } = await supabaseClient
        .from('artworks')
        .select('order')
        .order('order', { ascending: false })
        .limit(1);
      const newOrder = maxOrderData?.[0]?.order ? maxOrderData[0].order + 1 : 1;
  
      const { error } = await supabaseClient
        .from('artworks')
        .insert([{ title, project, year, type, description, imageurl, order: newOrder }]);
      if (error) throw error;
  
      res.json({ message: 'Artwork uploaded successfully', imageurl });
    } catch (error) {
      console.error('Error uploading artwork:', error);
      res.status(500).json({ error: 'Failed to upload artwork' });
    }
  });

// Existing DELETE /api/artworks/:id (unchanged)
app.delete('/api/artworks/:id', async (req, res) => {
  const { id } = req.params;
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { data: artwork, error: fetchError } = await supabaseClient
      .from('artworks')
      .select('imageurl')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;

    const { error } = await supabaseClient
      .from('artworks')
      .delete()
      .eq('id', id);
    if (error) throw error;

    if (artwork.imageurl) {
      const filename = artwork.imageurl.split('/').pop();
      const sftp = new Client();
      await sftp.connect({
        host: process.env.SFTP_HOST,
        port: process.env.SFTP_PORT,
        username: process.env.SFTP_USERNAME,
        password: process.env.SFTP_PASSWORD
      });
      await sftp.delete(`/sitoform_com/images/${filename}`);
      await sftp.end();
    }

    res.json({ message: 'Artwork deleted successfully' });
  } catch (error) {
    console.error('Error deleting artwork:', error);
    res.status(500).json({ error: 'Failed to delete artwork' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));