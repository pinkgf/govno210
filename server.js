const express = require('express');
const session = require('express-session');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка подключения к БД
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err);
        process.exit(1);
    }
    console.log('✅ Подключено к MySQL');
    
    // Создаем таблицы при запуске
    initTables();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'technikum_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 3600000 // 1 час
    }
}));

// Настройка загрузки фото
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'public/uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения!'));
        }
    }
});

// Middleware для проверки прав администратора
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Доступ запрещен. Только для администратора' });
    }
}

// Инициализация таблиц
function initTables() {
    // Таблица пользователей
    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
            id INT PRIMARY KEY AUTO_INCREMENT,
            username VARCHAR(50) NOT NULL UNIQUE,
            email VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(100) NOT NULL,
            role ENUM('admin', 'user') DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL
        )
    `;
    
    // Таблица техники
    const createTechniquesTable = `
        CREATE TABLE IF NOT EXISTS techniques (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL,
            category VARCHAR(50) NOT NULL,
            description TEXT,
            price DECIMAL(10, 2) NOT NULL,
            photo_url VARCHAR(255),
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `;
    
    db.query(createUsersTable, (err) => {
        if (err) console.error('Ошибка создания users:', err);
        else console.log('✅ Таблица users готова');
    });
    
    db.query(createTechniquesTable, (err) => {
        if (err) console.error('Ошибка создания techniques:', err);
        else console.log('✅ Таблица techniques готова');
    });
    
    // Проверяем, есть ли админ, если нет - создаем
    setTimeout(() => {
        db.query('SELECT * FROM users WHERE username = ?', ['admin'], async (err, results) => {
            if (err) return;
            if (results.length === 0) {
                const hash = await bcrypt.hash('admin123', 10);
                db.query(
                    'INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
                    ['admin', 'admin@technikum.com', hash, 'Администратор', 'admin'],
                    (err) => {
                        if (err) console.error('Ошибка создания админа:', err);
                        else console.log('✅ Создан администратор: admin / admin123');
                    }
                );
            }
        });
        
        // Создаем тестового пользователя
        db.query('SELECT * FROM users WHERE username = ?', ['user'], async (err, results) => {
            if (err) return;
            if (results.length === 0) {
                const hash = await bcrypt.hash('user123', 10);
                db.query(
                    'INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
                    ['user', 'user@technikum.com', hash, 'Обычный пользователь', 'user'],
                    (err) => {
                        if (err) console.error('Ошибка создания пользователя:', err);
                        else console.log('✅ Создан тестовый пользователь: user / user123');
                    }
                );
            }
        });
    }, 1000);
}

// Middleware для проверки авторизации
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

// ==================== HTML СТРАНИЦЫ ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'about.html'));
});

app.get('/contacts', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'contacts.html'));
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Только админ может добавлять технику
app.get('/add-technique', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).send('Доступ запрещен. Только для администратора');
    }
    res.sendFile(path.join(__dirname, 'views', 'add_technique.html'));
});

// Только админ может редактировать технику
app.get('/edit-technique/:id', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).send('Доступ запрещен. Только для администратора');
    }
    res.sendFile(path.join(__dirname, 'views', 'edit_technique.html'));
});

// ==================== API АВТОРИЗАЦИИ ====================

// Регистрация нового пользователя
app.post('/api/register', async (req, res) => {
    const { username, email, full_name, password } = req.body;
    
    // Валидация
    if (!username || !email || !full_name || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (username.length < 3) {
        return res.status(400).json({ error: 'Логин должен быть не менее 3 символов' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    
    if (!email.includes('@')) {
        return res.status(400).json({ error: 'Некорректный email' });
    }
    
    try {
        // Проверяем, существует ли пользователь
        const checkQuery = 'SELECT id FROM users WHERE username = ? OR email = ?';
        db.query(checkQuery, [username, email], async (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            
            if (results.length > 0) {
                return res.status(400).json({ error: 'Пользователь с таким логином или email уже существует' });
            }
            
            // Хешируем пароль
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Создаем пользователя (только роль user, админом может быть только предустановленный)
            const insertQuery = `
                INSERT INTO users (username, email, password_hash, full_name, role) 
                VALUES (?, ?, ?, ?, 'user')
            `;
            
            db.query(insertQuery, [username, email, hashedPassword, full_name], (err, result) => {
                if (err) {
                    return res.status(500).json({ error: 'Ошибка при создании пользователя' });
                }
                
                res.json({ 
                    success: true, 
                    message: 'Регистрация успешна',
                    userId: result.insertId 
                });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход пользователя
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const query = 'SELECT * FROM users WHERE username = ? OR email = ?';
    db.query(query, [username, username], async (err, results) => {
        if (err) {
            console.error('DB Error:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        
        if (results.length === 0) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }
        
        const user = results[0];
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }
        
        // Обновляем время последнего входа
        db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
        
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            role: user.role
        };
        
        res.json({ success: true, redirect: '/dashboard' });
    });
});

// Выход
app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Получение текущего пользователя
app.get('/api/user', isAuthenticated, (req, res) => {
    res.json(req.session.user);
});

// Получение профиля пользователя
app.get('/api/user/profile', isAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    
    db.query('SELECT id, username, email, full_name, role, created_at FROM users WHERE id = ?', 
        [userId], 
        (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json(results[0]);
        }
    );
});

// Получение списка пользователей (только для админа)
app.get('/api/users', isAuthenticated, isAdmin, (req, res) => {
    db.query('SELECT id, username, email, full_name, role, created_at, last_login FROM users ORDER BY created_at DESC', 
        (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json(results);
        }
    );
});

// ==================== API РАБОТЫ С ТЕХНИКОЙ ====================

// Получение списка техники (доступно всем авторизованным)
app.get('/api/techniques', isAuthenticated, (req, res) => {
    const query = `
        SELECT t.*, u.username as author_name 
        FROM techniques t
        LEFT JOIN users u ON t.created_by = u.id
        ORDER BY t.created_at DESC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Ошибка загрузки:', err);
            return res.status(500).json({ error: 'Ошибка загрузки данных' });
        }
        res.json(results);
    });
});

// Получение одной техники для редактирования (только админ)
app.get('/api/techniques/:id', isAuthenticated, isAdmin, (req, res) => {
    const techniqueId = req.params.id;
    
    db.query('SELECT * FROM techniques WHERE id = ?', [techniqueId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ error: 'Техника не найдена' });
        }
        res.json(results[0]);
    });
});

// Добавление техники (только админ)
app.post('/api/techniques', isAuthenticated, isAdmin, upload.single('photo'), (req, res) => {
    const { name, category, description, price } = req.body;
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;
    
    if (!name || !category || !price) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    const query = `
        INSERT INTO techniques (name, category, description, price, photo_url, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    db.query(query, [name, category, description, price, photoUrl, req.session.user.id], (err, result) => {
        if (err) {
            console.error('Ошибка добавления:', err);
            return res.status(500).json({ error: 'Ошибка добавления' });
        }
        res.json({ success: true, id: result.insertId });
    });
});

// Редактирование техники (только админ)
app.put('/api/techniques/:id', isAuthenticated, isAdmin, upload.single('photo'), (req, res) => {
    const techniqueId = req.params.id;
    const { name, category, description, price, existingPhoto } = req.body;
    const newPhoto = req.file;
    
    if (!name || !category || !price) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    // Получаем текущую информацию о технике
    db.query('SELECT photo_url FROM techniques WHERE id = ?', [techniqueId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ error: 'Техника не найдена' });
        }
        
        let photoUrl = existingPhoto;
        
        // Если загружено новое фото
        if (newPhoto) {
            // Удаляем старое фото, если оно есть и не совпадает с новым
            const oldPhoto = results[0].photo_url;
            if (oldPhoto && oldPhoto !== '/uploads/default.jpg') {
                const oldPhotoPath = path.join(__dirname, 'public', oldPhoto);
                if (fs.existsSync(oldPhotoPath)) {
                    fs.unlinkSync(oldPhotoPath);
                }
            }
            photoUrl = `/uploads/${newPhoto.filename}`;
        }
        
        // Обновляем запись
        const query = `
            UPDATE techniques 
            SET name = ?, category = ?, description = ?, price = ?, photo_url = ?
            WHERE id = ?
        `;
        
        db.query(query, [name, category, description, price, photoUrl, techniqueId], (err) => {
            if (err) {
                console.error('Ошибка обновления:', err);
                return res.status(500).json({ error: 'Ошибка обновления' });
            }
            res.json({ success: true });
        });
    });
});

// Удаление техники (только админ)
app.delete('/api/techniques/:id', isAuthenticated, isAdmin, (req, res) => {
    const techniqueId = req.params.id;
    
    // Получаем информацию о фото
    db.query('SELECT photo_url FROM techniques WHERE id = ?', [techniqueId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ error: 'Техника не найдена' });
        }
        
        // Удаляем фото, если есть
        if (results[0].photo_url) {
            const photoPath = path.join(__dirname, 'public', results[0].photo_url);
            if (fs.existsSync(photoPath)) {
                fs.unlinkSync(photoPath);
            }
        }
        
        // Удаляем запись
        db.query('DELETE FROM techniques WHERE id = ?', [techniqueId], (err) => {
            if (err) {
                console.error('Ошибка удаления:', err);
                return res.status(500).json({ error: 'Ошибка удаления' });
            }
            res.json({ success: true });
        });
    });
});

// ==================== АДМИН ПАНЕЛЬ УПРАВЛЕНИЯ БД ====================

// Страница управления БД (только для админа)
app.get('/admin/db', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).send('Доступ запрещен');
    }
    res.sendFile(path.join(__dirname, 'views', 'db_manager.html'));
});

// Получение списка всех таблиц в БД
app.get('/api/admin/tables', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const query = `
        SELECT TABLE_NAME 
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = ? 
        ORDER BY TABLE_NAME
    `;
    
    db.query(query, [process.env.DB_NAME], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения списка таблиц' });
        }
        const tables = results.map(row => row.TABLE_NAME);
        res.json(tables);
    });
});

// Получение данных из таблицы
app.get('/api/admin/table/:tableName', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const tableName = req.params.tableName;
    
    // Защита от SQL инъекций - проверяем существование таблицы
    const checkQuery = `
        SELECT TABLE_NAME 
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `;
    
    db.query(checkQuery, [process.env.DB_NAME, tableName], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ error: 'Таблица не найдена' });
        }
        
        // Получаем данные из таблицы
        db.query(`SELECT * FROM ?? ORDER BY id DESC LIMIT 100`, [tableName], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка получения данных' });
            }
            
            // Получаем количество записей
            db.query(`SELECT COUNT(*) as count FROM ??`, [tableName], (err, countResult) => {
                const count = countResult ? countResult[0].count : rows.length;
                
                res.json({
                    rows: rows,
                    count: count,
                    tableName: tableName
                });
            });
        });
    });
});

// Выполнение пользовательского SQL запроса (только SELECT для безопасности)
app.post('/api/admin/query', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const { query } = req.body;
    
    if (!query || query.trim().length === 0) {
        return res.status(400).json({ error: 'Запрос не может быть пустым' });
    }
    
    // Безопасность: блокируем опасные операции (кроме SELECT)
    const upperQuery = query.toUpperCase().trim();
    const dangerousOperations = ['DROP', 'DELETE FROM', 'TRUNCATE', 'ALTER', 'CREATE', 'INSERT', 'UPDATE', 'GRANT', 'REVOKE'];
    
    // Разрешаем только SELECT, SHOW, DESCRIBE, EXPLAIN
    const allowedOperations = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
    const isAllowed = allowedOperations.some(op => upperQuery.startsWith(op));
    
    if (!isAllowed) {
        return res.status(403).json({ 
            error: 'Разрешены только SELECT, SHOW, DESCRIBE, EXPLAIN запросы' 
        });
    }
    
    // Дополнительная проверка на опасные команды внутри запроса
    const hasDangerous = dangerousOperations.some(op => upperQuery.includes(op));
    if (hasDangerous && !upperQuery.startsWith('SELECT')) {
        return res.status(403).json({ error: 'Запрос содержит опасные операции' });
    }
    
    // Выполняем запрос
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Если результат - массив (SELECT), возвращаем данные
        if (Array.isArray(results)) {
            res.json({
                rows: results,
                count: results.length,
                query: query
            });
        } else {
            // Для других операций
            res.json({
                affectedRows: results.affectedRows || 0,
                changedRows: results.changedRows || 0,
                query: query
            });
        }
    });
});

// Обработка контактной формы
app.post('/api/contact', (req, res) => {
    const { name, email, subject, message } = req.body;
    
    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    
    // Здесь можно добавить отправку email или сохранение в БД
    console.log('Новое сообщение:', { name, email, subject, message });
    
    res.json({ success: true, message: 'Сообщение отправлено' });
});

// Получение структуры таблицы
app.get('/api/admin/table/:tableName/structure', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const tableName = req.params.tableName;
    
    db.query(`DESCRIBE ??`, [tableName], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения структуры' });
        }
        res.json(results);
    });
});

// Получение информации о базе данных
app.get('/api/admin/db-info', isAuthenticated, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const queries = {
        version: 'SELECT VERSION() as version',
        size: `SELECT 
            ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb 
            FROM information_schema.TABLES 
            WHERE table_schema = ?`,
        tables: `SELECT COUNT(*) as table_count FROM information_schema.TABLES WHERE table_schema = ?`,
        connections: 'SHOW STATUS LIKE "Threads_connected"'
    };
    
    db.query(queries.version, (err, version) => {
        db.query(queries.size, [process.env.DB_NAME], (err, size) => {
            db.query(queries.tables, [process.env.DB_NAME], (err, tables) => {
                db.query(queries.connections, (err, connections) => {
                    res.json({
                        version: version[0].version,
                        size_mb: size[0].size_mb || 0,
                        table_count: tables[0].table_count,
                        connections: connections[1]?.Value || 0
                    });
                });
            });
        });
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🚀 Сервер успешно запущен!                               ║
╠══════════════════════════════════════════════════════════════╣
║  📍 Адрес: http://localhost:${PORT}                          ║
╠══════════════════════════════════════════════════════════════╣
║  📄 Доступные страницы:                                      ║
║     • Главная: http://localhost:${PORT}/                     ║
║     • О нас: http://localhost:${PORT}/about                  ║
║     • Контакты: http://localhost:${PORT}/contacts            ║
║     • Вход: http://localhost:${PORT}/login                   ║
║     • Регистрация: http://localhost:${PORT}/register         ║
╠══════════════════════════════════════════════════════════════╣
║  🔑 Права доступа:                                           ║
║     • 👑 АДМИНИСТРАТОР: может создавать, редактировать,      ║
║       удалять технику и просматривать пользователей          ║
║     • 👤 ПОЛЬЗОВАТЕЛЬ: может только просматривать технику    ║
╠══════════════════════════════════════════════════════════════╣
║  🔐 Тестовые данные:                                         ║
║     • Админ: admin / admin123                                ║
║     • Пользователь: user / password                          ║
╚══════════════════════════════════════════════════════════════╝
    `);
});