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
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!supabaseKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY environment variable is not set');
}
const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Validate SFTP environment variables
const requiredSftpVars = ['SFTP_HOST', 'SFTP_PORT', 'SFTP_USERNAME', 'SFTP_PASSWORD'];
const missingSftpVars = requiredSftpVars.filter(varName => !process.env[varName]);
if (missingSftpVars.length > 0) {
  console.error(`Missing SFTP environment variables: ${missingSftpVars.join(', ')}`);
}

app.get('/api/artworks', async (req, res) => {
  try {
    const { data, error } = await supabaseClient
      .from('artworks')
      .select('*')
      .order('order', { ascending: true });
    if (error) throw error;
    console.log('Fetched artworks:', data.length);
    res.json(data);
  } catch (error) {
    console.error('Error fetching artworks:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    res.status(500).json({ error: 'Failed to fetch artworks' });
  }
});

app.post('/api/artworks', multer().single('image'), async (req, res) => {
  const { project, year, type, description } = req.body;
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
      if (missingSftpVars.length > 0) {
        console.error('Cannot upload image: Missing SFTP variables');
        return res.status(500).json({ error: `SFTP configuration incomplete: missing ${missingSftpVars.join(', ')}` });
      }

      const sftp = new Client();
      try {
        const sftpConfig = {
          host: process.env.SFTP_HOST,
          port: parseInt(process.env.SFTP_PORT) || 22,
          username: process.env.SFTP_USERNAME,
          password: process.env.SFTP_PASSWORD,
          retries: 3,
          readyTimeout: 10000
        };
        console.log('Attempting SFTP connection:', {
          host: sftpConfig.host,
          port: sftpConfig.port,
          username: sftpConfig.username
        });
        await sftp.connect(sftpConfig);
        console.log('SFTP connected successfully');

        const remoteDir = '/sitoform_com/images';
        const remotePath = `${remoteDir}/${req.file.originalname}`;
        const dirExists = await sftp.exists(remoteDir);
        if (!dirExists) {
          console.log(`Creating directory: ${remoteDir}`);
          await sftp.mkdir(remoteDir, true);
        }

        console.log('Uploading to:', remotePath);
        await sftp.put(req.file.buffer, remotePath);
        imageurl = `https://sitoform.com/images/${req.file.originalname}`;
        console.log('SFTP upload successful:', imageurl);
        await sftp.end();
      } catch (sftpError) {
        console.error('Detailed SFTP error:', {
          message: sftpError.message,
          code: sftpError.code,
          stack: sftpError.stack
        });
        await sftp.end().catch(() => {});
        return res.status(500).json({ error: `Failed to upload image to SFTP: ${sftpError.message}` });
      }
    } else {
      console.log('No image file provided');
      return res.status(400).json({ error: 'Image file is required' });
    }

    const { data: maxOrderData } = await supabaseClient
      .from('artworks')
      .select('order')
      .order('order', { ascending: false })
      .limit(1);
    const newOrder = maxOrderData?.[0]?.order ? maxOrderData[0].order + 1 : 1;

    console.log('Inserting artwork:', { project, year, type, description, imageurl, order: newOrder });
    const { data, error } = await supabaseClient
      .from('artworks')
      .insert([{ project, year, type, description, imageurl, order: newOrder }])
      .select();
    if (error) {
      console.error('Insert error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    res.json({ message: 'Artwork uploaded successfully', imageurl, id: data[0].id });
  } catch (error) {
    console.error('Error uploading artwork:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    res.status(500).json({ error: `Failed to upload artwork: ${error.message}` });
  }
});

app.patch('/api/artworks/reorder', async (req, res) => {
  const { order } = req.body;
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    console.log('Updating order:', order);
    for (const { id, order: newOrder } of order) {
      const { error } = await supabaseClient
        .from('artworks')
        .update({ order: newOrder })
        .eq('id', id);
      if (error) {
        console.error('Update order error:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
    }

    res.json({ message: 'Order updated successfully' });
  } catch (error) {
    console.error('Error updating order:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    res.status(500).json({ error: `Failed to update order: ${error.message}` });
  }
});

app.patch('/api/artworks/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    console.log('Updating artwork:', id, updates);
    const { error } = await supabaseClient
      .from('artworks')
      .update(updates)
      .eq('id', id);
    if (error) {
      console.error('Update artwork error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    res.json({ message: 'Artwork updated successfully' });
  } catch (error) {
    console.error('Error updating artwork:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    res.status(500).json({ error: `Failed to update artwork: ${error.message}` });
  }
});

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

    console.log('Deleting artwork:', id);
    const { error } = await supabaseClient
      .from('artworks')
      .delete()
      .eq('id', id);
    if (error) {
      console.error('Delete artwork error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    res.json({ message: 'Artwork deleted successfully' });
  } catch (error) {
    console.error('Error deleting artwork:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    res.status(500).json({ error: `Failed to delete artwork: ${error.message}` });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));