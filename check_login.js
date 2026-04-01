const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

async function checkLogin() {
    const username = 'admin';
    const password = 'admin123';
    
    console.log('🔍 Проверка входа...\n');
    
    // Получаем пользователя из БД
    connection.query(
        'SELECT * FROM users WHERE username = ? OR email = ?',
        [username, username],
        async (err, results) => {
            if (err) {
                console.error('Ошибка:', err);
                connection.end();
                return;
            }
            
            if (results.length === 0) {
                console.log('❌ Пользователь не найден');
                connection.end();
                return;
            }
            
            const user = results[0];
            console.log('✅ Пользователь найден:', user.username);
            console.log('Email:', user.email);
            console.log('Хеш из БД:', user.password_hash);
            console.log('Длина хеша:', user.password_hash.length);
            console.log('Начинается с:', user.password_hash.substring(0, 7));
            console.log('');
            
            // Проверяем пароль
            const isValid = await bcrypt.compare(password, user.password_hash);
            console.log('Результат проверки пароля:', isValid);
            
            if (isValid) {
                console.log('✅ ПАРОЛЬ ПРАВИЛЬНЫЙ!');
                console.log('Вход должен работать');
            } else {
                console.log('❌ ПАРОЛЬ НЕПРАВИЛЬНЫЙ!');
                console.log('\nСоздаем правильный хеш...');
                const newHash = await bcrypt.hash(password, 10);
                console.log('Правильный хеш для пароля "admin123":');
                console.log(newHash);
                console.log('\nВыполните SQL:');
                console.log(`UPDATE users SET password_hash = '${newHash}' WHERE username = 'admin';`);
            }
            
            connection.end();
        }
    );
}

checkLogin();