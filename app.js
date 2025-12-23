const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./db'); // use db.js

const app = express();

// ================== CONFIG ==================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'rent-tracker-secret-key',
    resave: false,
    saveUninitialized: false
}));

// ================== GLOBAL VARS ==================
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// ================== AUTH MIDDLEWARE ==================
function isAuthenticated(req, res, next) {
    if(req.session.user) return next();
    res.redirect('/login');
}

// ================== RATE LIMIT ==================
const loginAttempts = {};
function rateLimit(req, res, next) {
    const ip = req.ip;
    loginAttempts[ip] = loginAttempts[ip] || { count: 0, time: Date.now() };

    if (loginAttempts[ip].count >= 5 &&
        Date.now() - loginAttempts[ip].time < 15*60*1000) {
        return res.render('login', { error: 'Too many attempts. Try again later.' });
    }

    next();
}

// ================== AUTH ROUTES ==================

// Login page
app.get('/login', (req,res) => res.render('login', { error: null }));

// Login handler
app.post('/login', rateLimit, (req,res) => {
    const { username, password } = req.body;
    const ip = req.ip;

    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if(err) return res.render('login', { error: 'Database error' });
        if(!user || !bcrypt.compareSync(password, user.password)) {
            loginAttempts[ip].count++;
            loginAttempts[ip].time = Date.now();
            return res.render('login', { error: 'Invalid credentials' });
        }

        // successful login
        loginAttempts[ip] = { count: 0, time: Date.now() };
        req.session.user = { id: user.id, username: user.username };
        res.redirect('/');
    });
});

// Signup page
app.get('/signup', (req,res) => res.render('signup', { error: null }));

// Signup handler
app.post('/signup', (req,res) => {
    const { username, password } = req.body;
    if(!username || !password) return res.render('signup', { error: 'All fields required' });

    const hashed = bcrypt.hashSync(password, 10);

    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashed], function(err){
        if(err) return res.render('signup', { error: 'Username already exists' });

        req.session.user = { id: this.lastID, username };
        res.redirect('/');
    });
});

// Logout
app.get('/logout', (req,res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ================== DASHBOARD ==================
app.get('/', isAuthenticated, (req,res) => {
    const userId = req.session.user.id;

    db.all(`
        SELECT r.*, t.name AS tenant_name
        FROM rent r
        JOIN tenants t ON r.tenant_id = t.id
        WHERE r.user_id = ?
        ORDER BY r.date_collected DESC
    `, [userId], (err, records) => {
        if(err) return res.send('Database error');

        db.all("SELECT * FROM tenants WHERE user_id = ?", [userId], (err2, tenants) => {
            if(err2) return res.send('Database error');

            const totals = {};
            records.forEach(r => totals[r.month] = (totals[r.month]||0)+r.amount);

            res.render('index', { records, tenants, totals });
        });
    });
});

// ================== ADD RENT ==================
app.post('/add', isAuthenticated, (req,res) => {
    const { tenant_id, month, amount, date_collected, notes } = req.body;
    const userId = req.session.user.id;

    db.run(`INSERT INTO rent (user_id, tenant_id, month, amount, date_collected, notes)
            VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, tenant_id, month, amount, date_collected, notes],
        (err) => err ? res.send('Failed') : res.redirect('/')
    );
});

// ================== TENANTS ==================
app.get('/tenants', isAuthenticated, (req,res) => {
    db.all("SELECT * FROM tenants WHERE user_id = ?", [req.session.user.id], (err, tenants) => {
        res.render('tenants', { tenants });
    });
});

app.post('/tenants/add', isAuthenticated, (req,res) => {
    db.run("INSERT INTO tenants (user_id, name, phone) VALUES (?, ?, ?)",
        [req.session.user.id, req.body.name, req.body.phone],
        () => res.redirect('/tenants')
    );
});

// ================== START SERVER ==================
app.listen(3000, () => console.log('✅ Server running at http://localhost:3000'));
