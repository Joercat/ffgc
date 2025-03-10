const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client } = require("pg");
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const client = new Client({
    user: "name_0sve_user",
    host: "dpg-cv4r9fgfnakc73bs6j70-a",
    database: "name_0sve",
    password: "QJ8CigzWJNLJacIpgQGxfVdmMlS5eeo3",
    port: "5432"
});

client.connect();

const upload = multer({
    limits: {
        fileSize: 2 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

async function initDatabase() {
    await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            content TEXT NOT NULL,
            image_data BYTEA,
            is_image BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

initDatabase();

app.use(express.static('public'));

app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const imageBuffer = req.file.buffer;
        const userId = req.body.userId;
        
        const result = await client.query(
            'INSERT INTO messages (user_id, content, image_data, is_image) VALUES ($1, $2, $3, true) RETURNING id',
            [userId, 'Image Upload', imageBuffer]
        );

        const imageId = result.rows[0].id;
        res.json({ success: true, imageId });
    } catch (error) {
        res.status(500).json({ error: 'Upload failed' });
    }
});

app.get('/image/:id', async (req, res) => {
    try {
        const result = await client.query(
            'SELECT image_data FROM messages WHERE id = $1 AND is_image = true',
            [req.params.id]
        );
        
        if (result.rows.length > 0) {
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': result.rows[0].image_data.length
            });
            res.end(result.rows[0].image_data);
        } else {
            res.status(404).send('Image not found');
        }
    } catch (error) {
        res.status(500).send('Error retrieving image');
    }
});

const activeUsers = new Set();

io.on('connection', async (socket) => {
    socket.on('check-username', async (username) => {
        try {
            const result = await client.query('SELECT username FROM users WHERE username = $1', [username]);
            socket.emit('username-result', result.rows.length === 0);
        } catch (error) {
            console.error('Username check error:', error);
        }
    });

    socket.on('new-user', async (username) => {
        try {
            if (activeUsers.has(username)) {
                socket.emit('username-taken', true);
                return;
            }

            const result = await client.query(
                'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id',
                [username]
            );
            
            socket.userId = result.rows[0].id;
            socket.username = username;
            activeUsers.add(username);
            
            const messages = await client.query(
                'SELECT messages.*, users.username FROM messages JOIN users ON messages.user_id = users.id ORDER BY messages.created_at DESC LIMIT 50'
            );
            
            socket.emit('load-messages', messages.rows.reverse());
            io.emit('user-connected', Array.from(activeUsers));
        } catch (error) {
            console.error('User connection error:', error);
        }
    });

    socket.on('send-message', async (message) => {
        try {
            await client.query(
                'INSERT INTO messages (user_id, content) VALUES ($1, $2)',
                [socket.userId, message]
            );
            
            io.emit('chat-message', {
                message: message,
                username: socket.username,
                timestamp: new Date().toLocaleTimeString()
            });
        } catch (error) {
            console.error('Message sending error:', error);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            activeUsers.delete(socket.username);
            io.emit('user-disconnected', Array.from(activeUsers));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
