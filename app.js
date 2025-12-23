const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./rent-tracker.db');

// ================== APP CONFIG ==================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
    session({
        secret: 'rent-tracker-secret-key',
        resave: false,
        saveUninitialized: false,
    })
);

// ================== GLOBAL TEMPLATE VARS ==================
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// ================== AUTH MIDDLEWARE ==================
function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

// ================== AUTH ROUTES ==================

// LOGIN
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.get(
        'SELECT * FROM users WHERE username = ?',
        [username],
        (err, user) => {
            if (err) return res.render('login', { error: 'Database error' });
            if (!user)
                return res.render('login', { error: 'Invalid credentials' });

            if (!bcrypt.compareSync(password, user.password)) {
                return res.render('login', { error: 'Invalid credentials' });
            }

            req.session.user = {
                id: user.id,
                username: user.username,
            };

            res.redirect('/');
        }
    );
});

// SIGNUP
app.get('/signup', (req, res) => {
    res.render('signup', { error: null });
});

app.post('/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.render('signup', { error: 'All fields required' });
    }

    const hashed = bcrypt.hashSync(password, 10);

    db.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, hashed],
        function (err) {
            if (err) {
                return res.render('signup', {
                    error: 'Username already exists',
                });
            }

            req.session.user = {
                id: this.lastID,
                username,
            };

            res.redirect('/');
        }
    );
});

// LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// ================== DASHBOARD ==================
app.get('/', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;

    db.all(
        `
        SELECT r.*, t.name AS tenant_name
        FROM rent r
        JOIN tenants t ON r.tenant_id = t.id
        WHERE r.user_id = ?
        ORDER BY r.date_collected DESC
        `,
        [userId],
        (err, records) => {
            if (err) return res.send('Database error');

            db.all(
                'SELECT * FROM tenants WHERE user_id = ?',
                [userId],
                (err2, tenants) => {
                    if (err2) return res.send('Database error');

                    const totals = {};
                    records.forEach((r) => {
                        totals[r.month] =
                            (totals[r.month] || 0) + r.amount;
                    });

                    res.render('index', {
                        records,
                        tenants,
                        totals,
                    });
                }
            );
        }
    );
});

// ================== ADD RENT ==================
app.post('/add', isAuthenticated, (req, res) => {
    const { tenant_id, month, amount, date_collected, notes } = req.body;
    const userId = req.session.user.id;

    db.run(
        `
        INSERT INTO rent (user_id, tenant_id, month, amount, date_collected, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [userId, tenant_id, month, amount, date_collected, notes],
        (err) => {
            if (err) return res.send('Failed to add record');
            res.redirect('/');
        }
    );
});

// ================== PARSE M-PESA ==================
app.post('/parse', isAuthenticated, (req, res) => {
    const { message } = req.body;
    const userId = req.session.user.id;

    const regex =
        /received Ksh([\d,\.]+) from (.+?) (\d{10}) on (\d{2}\/\d{2}\/\d{2})/i;
    const match = message.match(regex);

    if (!match) return res.send('Invalid M-PESA message');

    const amount = parseFloat(match[1].replace(/,/g, ''));
    const name = match[2];
    const phone = match[3];
    const month = match[4];

    db.get(
        'SELECT * FROM tenants WHERE user_id = ? AND phone = ?',
        [userId, phone],
        (err, tenant) => {
            if (tenant) {
                insertRent(tenant.id);
            } else {
                db.run(
                    'INSERT INTO tenants (user_id, name, phone) VALUES (?, ?, ?)',
                    [userId, name, phone],
                    function () {
                        insertRent(this.lastID);
                    }
                );
            }
        }
    );

    function insertRent(tenantId) {
        db.run(
            `
            INSERT INTO rent (user_id, tenant_id, month, amount, date_collected)
            VALUES (?, ?, ?, ?, DATE('now'))
            `,
            [userId, tenantId, month, amount],
            () => res.redirect('/')
        );
    }
});

// ================== DELETE RENT ==================
app.post('/delete/:id', isAuthenticated, (req, res) => {
    db.run(
        'DELETE FROM rent WHERE id = ? AND user_id = ?',
        [req.params.id, req.session.user.id],
        () => res.redirect('/')
    );
});

// ================== EDIT RENT ==================
app.get('/edit/:id', isAuthenticated, (req, res) => {
    db.get(
        'SELECT * FROM rent WHERE id = ? AND user_id = ?',
        [req.params.id, req.session.user.id],
        (err, record) => {
            if (!record) return res.send('Access denied');
            res.render('edit', { record });
        }
    );
});

app.post('/edit/:id', isAuthenticated, (req, res) => {
    const { month, amount, date_collected, notes } = req.body;

    db.run(
        `
        UPDATE rent
        SET month = ?, amount = ?, date_collected = ?, notes = ?
        WHERE id = ? AND user_id = ?
        `,
        [
            month,
            amount,
            date_collected,
            notes,
            req.params.id,
            req.session.user.id,
        ],
        function () {
            res.redirect('/');
        }
    );
});

// ================== TENANTS ==================
app.get('/tenants', isAuthenticated, (req, res) => {
    db.all(
        'SELECT * FROM tenants WHERE user_id = ?',
        [req.session.user.id],
        (err, tenants) => {
            res.render('tenants', { tenants });
        }
    );
});

app.post('/tenants/add', isAuthenticated, (req, res) => {
    db.run(
        'INSERT INTO tenants (user_id, name, phone) VALUES (?, ?, ?)',
        [req.session.user.id, req.body.name, req.body.phone],
        () => res.redirect('/tenants')
    );
});

app.post('/tenants/delete/:id', isAuthenticated, (req, res) => {
    db.run(
        'DELETE FROM tenants WHERE id = ? AND user_id = ?',
        [req.params.id, req.session.user.id],
        () => res.redirect('/tenants')
    );
});

// ================== SUMMARY ==================
app.get('/summary', isAuthenticated, (req, res) => {
    db.all(
        `
        SELECT r.amount, r.month, t.name AS tenant
        FROM rent r
        JOIN tenants t ON r.tenant_id = t.id
        WHERE r.user_id = ?
        `,
        [req.session.user.id],
        (err, rows) => {
            const totals = {};
            const tenantTotals = {};

            rows.forEach((r) => {
                totals[r.month] = (totals[r.month] || 0) + r.amount;
                tenantTotals[r.tenant] =
                    (tenantTotals[r.tenant] || 0) + r.amount;
            });

            res.render('summary', { totals, tenantTotals });
        }
    );
});

// ================== EXPORT CSV ==================
app.get('/export', isAuthenticated, (req, res) => {
    db.all(
        `
        SELECT t.name, r.month, r.amount, r.date_collected, r.notes
        FROM rent r
        JOIN tenants t ON r.tenant_id = t.id
        WHERE r.user_id = ?
        `,
        [req.session.user.id],
        (err, rows) => {
            let csv = 'Tenant,Month,Amount,Date,Notes\n';
            rows.forEach((r) => {
                csv += `"${r.name}","${r.month}","${r.amount}","${r.date_collected}","${r.notes || ''}"\n`;
            });

            res.header('Content-Type', 'text/csv');
            res.header(
                'Content-Disposition',
                'attachment; filename="rent_records.csv"'
            );
            res.send(csv);
        }
    );
});

// ================== START SERVER ==================
app.listen(3000, () =>
    console.log('✅ Server running at http://localhost:3000')
);
