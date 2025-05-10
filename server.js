const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const Client = require('ssh2-sftp-client');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Set Content-Security-Policy for API responses
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://sitoform.com https://via.placeholder.com https://img.youtube.com blob:; frame-src 'self' https://www.youtube.com https://player.vimeo.com; connect-src 'self' https://sitoform25.onrender.com https://ydfkrwjafnuvdvezpkcp.supabase.co https://www.youtube.com https://player.vimeo.com"
  );
  res.setHeader('Permissions-Policy', "compute-pressure=(self 'https://www.youtube.com')");
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client:', err.stack);
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
  const { project, year, type, description, order } = req.body;
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

    let newOrder;
    if (order && !isNaN(parseInt(order))) {
      newOrder = parseInt(order);
    } else {
      const { data: maxOrderData } = await supabaseClient
        .from('artworks')
        .select('order')
        .order('order', { ascending: false })
        .limit(1);
      newOrder = maxOrderData?.[0]?.order ? maxOrderData[0].order + 1 : 1;
    }

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

    if (order && !isNaN(parseInt(order))) {
      const { data: allArtworks, error: fetchError } = await supabaseClient
        .from('artworks')
        .select('*')
        .order('order', { ascending: true });

      if (fetchError) throw fetchError;

      const updatedArtworks = allArtworks.map((artwork) => {
        if (artwork.id === data[0].id) {
          return { ...artwork, order: newOrder };
        }
        return artwork;
      });

      updatedArtworks.sort((a, b) => a.order - b.order);
      let currentOrder = 1;
      const finalArtworks = updatedArtworks.map((artwork) => {
        const newOrderValue = currentOrder;
        currentOrder++;
        return { ...artwork, order: newOrderValue };
      });

      for (const artwork of finalArtworks) {
        const { error: updateError } = await supabaseClient
          .from('artworks')
          .update({ order: artwork.order })
          .eq('id', artwork.id);
        if (updateError) throw updateError;
      }
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

app.patch('/api/artworks/:id', multer().single('image'), async (req, res) => {
  const { id } = req.params;
  const token = req.headers.authorization?.split('Bearer ')[1];
  const { project, year, type, description, imageurl: bodyImageUrl, order } = req.body;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    let updates = { project, year, type, description };
    if (order !== undefined) updates.order = parseInt(order);

    let newImageUrl = bodyImageUrl;
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
        console.log('Attempting SFTP connection for image update:', {
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
        newImageUrl = `https://sitoform.com/images/${req.file.originalname}`;
        console.log('SFTP upload successful:', newImageUrl);
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
    }

    if (newImageUrl) {
      updates.imageurl = newImageUrl;
    }

    if (order !== undefined) {
      const newOrder = parseInt(order);
      const { data: allArtworks, error: fetchError } = await supabaseClient
        .from('artworks')
        .select('*')
        .order('order', { ascending: true });

      if (fetchError) {
        console.error('Fetch artworks error:', {
          message: fetchError.message,
          code: fetchError.code,
          details: fetchError.details,
          hint: fetchError.hint
        });
        throw fetchError;
      }

      const updatedArtworks = allArtworks.map((artwork) => {
        if (artwork.id === parseInt(id)) {
          return { ...artwork, order: newOrder };
        }
        return artwork;
      });

      updatedArtworks.sort((a, b) => a.order - b.order);
      let currentOrder = 1;
      const finalArtworks = updatedArtworks.map((artwork) => {
        const newOrderValue = currentOrder;
        currentOrder++;
        return { ...artwork, order: newOrderValue };
      });

      for (const artwork of finalArtworks) {
        const { error: updateError } = await supabaseClient
          .from('artworks')
          .update({ order: artwork.order })
          .eq('id', artwork.id);
        if (updateError) {
          console.error('Update order error:', {
            message: updateError.message,
            code: updateError.code,
            details: updateError.details,
            hint: updateError.hint
          });
          throw updateError;
        }
      }
    }

    console.log('Updating artwork:', id, updates);
    const { data, error } = await supabaseClient
      .from('artworks')
      .update(updates)
      .eq('id', id)
      .select();
    if (error) {
      console.error('Update artwork error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    if (!data.length) {
      return res.status(404).json({ error: 'Artwork not found' });
    }

    res.json({ message: 'Artwork updated successfully', imageurl: data[0].imageurl });
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