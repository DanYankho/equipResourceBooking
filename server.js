const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Data directory path
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
fs.ensureDirSync(DATA_DIR);

// CSV File paths
const FILES = {
    users: path.join(DATA_DIR, 'users.csv'),
    bookings: path.join(DATA_DIR, 'bookings.csv'),
    resources: path.join(DATA_DIR, 'resources.csv'),
    admins: path.join(DATA_DIR, 'admins.csv')
};

// Default data if files don't exist
const DEFAULT_DATA = {
    users: [
        { id: '1', name: 'John Smith', department: 'Marketing', role: 'individual', email: 'john@company.com' },
        { id: '2', name: 'Sarah Johnson', department: 'Sales', role: 'individual', email: 'sarah@company.com' },
        { id: '3', name: 'Marketing Dept', department: 'Marketing', role: 'dept', email: 'marketing@company.com' },
        { id: '4', name: 'Sales Dept', department: 'Sales', role: 'dept', email: 'sales@company.com' }
    ],
    resources: [
        { id: 'boardroom', name: 'Main Board Room', type: 'room' },
        { id: 'car', name: 'Company Car 1', type: 'vehicle' }
    ],
    admins: [
        { username: 'admin', password: 'admin123', name: 'System Administrator' }
    ],
    bookings: []
};

// Initialize CSV files if they don't exist
async function initializeFiles() {
    for (const [key, filePath] of Object.entries(FILES)) {
        if (!await fs.pathExists(filePath)) {
            await writeCSV(key, DEFAULT_DATA[key] || []);
            console.log(`Created default ${key}.csv`);
        }
    }
}

// Read CSV file
async function readCSV(filename) {
    const filePath = FILES[filename];
    if (!await fs.pathExists(filePath)) {
        return [];
    }

    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

// Write CSV file
async function writeCSV(filename, data) {
    const filePath = FILES[filename];
    
    if (data.length === 0) {
        // Write empty file with headers only
        const headers = getHeadersForFile(filename);
        await fs.writeFile(filePath, headers.join(',') + '\n');
        return;
    }

    const headers = Object.keys(data[0]).map(key => ({ id: key, title: key }));
    
    const csvWriter = createCsvWriter({
        path: filePath,
        header: headers
    });

    await csvWriter.writeRecords(data);
}

// Get headers for empty files
function getHeadersForFile(filename) {
    const headers = {
        users: ['id', 'name', 'department', 'role', 'email'],
        bookings: ['id', 'resource', 'date', 'startTime', 'endTime', 'user', 'department', 'type', 'purpose', 'invitees'],
        resources: ['id', 'name', 'type'],
        admins: ['username', 'password', 'name']
    };
    return headers[filename] || [];
}

// API Routes

// Get all data (for initialization)
app.get('/api/data', async (req, res) => {
    try {
        const [users, bookings, resources, admins] = await Promise.all([
            readCSV('users'),
            readCSV('bookings'),
            readCSV('resources'),
            readCSV('admins')
        ]);

        res.json({
            success: true,
            users,
            bookings,
            resources,
            admins
        });
    } catch (error) {
        console.error('Error reading data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get specific data type
app.get('/api/:type', async (req, res) => {
    try {
        const { type } = req.params;
        if (!FILES[type]) {
            return res.status(400).json({ success: false, error: 'Invalid data type' });
        }
        
        const data = await readCSV(type);
        res.json({ success: true, data });
    } catch (error) {
        console.error(`Error reading ${req.params.type}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admins = await readCSV('admins');
        
        const admin = admins.find(a => a.username === username && a.password === password);
        
        if (admin) {
            res.json({
                success: true,
                user: {
                    username: admin.username,
                    name: admin.name,
                    role: 'admin'
                }
            });
        } else {
            res.json({ success: false, error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add booking
app.post('/api/bookings', async (req, res) => {
    try {
        const booking = req.body;
        
        // Validate required fields
        if (!booking.id || !booking.resource || !booking.date || !booking.startTime || !booking.endTime || !booking.user) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Read existing bookings
        const bookings = await readCSV('bookings');
        
        // Check for conflicts
        const hasConflict = bookings.some(b => 
            b.resource === booking.resource &&
            b.date === booking.date &&
            ((b.startTime <= booking.startTime && b.endTime > booking.startTime) ||
             (b.startTime < booking.endTime && b.endTime >= booking.endTime) ||
             (b.startTime >= booking.startTime && b.endTime <= booking.endTime))
        );

        if (hasConflict) {
            return res.status(409).json({ success: false, error: 'Time slot conflicts with existing booking' });
        }

        // Add new booking
        bookings.push(booking);
        await writeCSV('bookings', bookings);
        
        res.json({ success: true, booking });
    } catch (error) {
        console.error('Error adding booking:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update booking
app.put('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        let bookings = await readCSV('bookings');
        const index = bookings.findIndex(b => b.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }

        bookings[index] = { ...bookings[index], ...updates };
        await writeCSV('bookings', bookings);
        
        res.json({ success: true, booking: bookings[index] });
    } catch (error) {
        console.error('Error updating booking:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete booking
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        let bookings = await readCSV('bookings');
        bookings = bookings.filter(b => b.id !== id);
        
        await writeCSV('bookings', bookings);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting booking:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add user
app.post('/api/users', async (req, res) => {
    try {
        const user = req.body;
        
        if (!user.id || !user.name) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const users = await readCSV('users');
        users.push(user);
        await writeCSV('users', users);
        
        res.json({ success: true, user });
    } catch (error) {
        console.error('Error adding user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update user
app.put('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        let users = await readCSV('users');
        const index = users.findIndex(u => u.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        users[index] = { ...users[index], ...updates };
        await writeCSV('users', users);
        
        res.json({ success: true, user: users[index] });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete user
app.delete('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        let users = await readCSV('users');
        users = users.filter(u => u.id !== id);
        
        await writeCSV('users', users);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add resource
app.post('/api/resources', async (req, res) => {
    try {
        const resource = req.body;
        
        if (!resource.id || !resource.name) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const resources = await readCSV('resources');
        resources.push(resource);
        await writeCSV('resources', resources);
        
        res.json({ success: true, resource });
    } catch (error) {
        console.error('Error adding resource:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update resource
app.put('/api/resources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        let resources = await readCSV('resources');
        const index = resources.findIndex(r => r.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Resource not found' });
        }

        resources[index] = { ...resources[index], ...updates };
        await writeCSV('resources', resources);
        
        res.json({ success: true, resource: resources[index] });
    } catch (error) {
        console.error('Error updating resource:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete resource
app.delete('/api/resources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        let resources = await readCSV('resources');
        resources = resources.filter(r => r.id !== id);
        
        await writeCSV('resources', resources);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting resource:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export CSV endpoint (download file)
app.get('/api/export/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const filePath = FILES[type];
        
        if (!filePath || !await fs.pathExists(filePath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }
        
        res.download(filePath, `${type}.csv`);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Real-time updates endpoint (long polling)
app.get('/api/updates/:timestamp', async (req, res) => {
    // Simple implementation - in production, use WebSockets
    const { timestamp } = req.params;
    const clientTime = parseInt(timestamp) || 0;
    const serverTime = Date.now();
    
    // If client is older than 5 seconds, send fresh data
    if (serverTime - clientTime > 5000) {
        try {
            const [users, bookings, resources] = await Promise.all([
                readCSV('users'),
                readCSV('bookings'),
                readCSV('resources')
            ]);
            
            res.json({
                updated: true,
                timestamp: serverTime,
                data: { users, bookings, resources }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    } else {
        res.json({ updated: false, timestamp: serverTime });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: 'Something went wrong!' });
});

// Start server
initializeFiles().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📁 Data directory: ${DATA_DIR}`);
    });
});
